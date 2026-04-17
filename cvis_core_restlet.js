/**
 * CVIS Core Tracker — NetSuite SuiteScript 2.0 RESTlet
 * File: cvis_core_restlet.js
 * Deploy as: RESTlet (Script Type: RESTlet)
 *
 * Workflows:
 *   "bin_pickup" — Core collected from customer's bin, physically arriving at CVIS shop.
 *                  Marks SO/Invoice/Quote received, flips Core Bank status to Applied,
 *                  sends credit notification email to AP/AR. FastFields triggered externally.
 *
 *   "bank_draw"  — Core already at CVIS (right container), being pulled for a new sales order.
 *                  Marks new SO as Core Received, flips Core Bank status to Applied.
 *                  No FastFields, no credit email (bin customers not charged upfront).
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/email', 'N/runtime', 'N/log', 'N/format'],
function(search, record, email, runtime, log, format) {

  const APAR_EMAIL = 'account@cardinalvalley.com';

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function daysBetween(dateStr) {
    const sale = new Date(dateStr);
    const today = new Date();
    return Math.round((today - sale) / (1000 * 60 * 60 * 24));
  }

  function creditInfo(daysOut, fee) {
    if (daysOut <= 30) return { pct: 100, amount: fee,        label: 'Full credit (within 30 days)' };
    else               return { pct: 50,  amount: fee * 0.5,  label: '50% credit (past 30 days)'    };
  }

  function fmtCurr(n) {
    return '$' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtDate(d) {
    if (!d) return 'N/A';
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ─── GET: Pull outstanding core charge lines from open Sales Orders ─────────
  function doGet(params) {
    try {
      var results = [];

      var soSearch = search.create({
        type: search.Type.SALES_ORDER,
        filters: [
          ['mainline',              'is',      'F'],
          'AND', ['item.name',      'contains', 'CORE CHARGE'],
          'AND', ['status',         'anyof',   'SalesOrd:B','SalesOrd:D','SalesOrd:E','SalesOrd:F'],
          'AND', [
            ['custcol_core_received', 'is',      'F'],
            'OR',
            ['custcol_core_received', 'isempty', '']
          ]
        ],
        columns: [
          'tranid', 'entity', 'trandate', 'item', 'rate', 'line', 'quantity',
          'custcol_core_received', 'custcol_core_received_date',
          'custcol_core_qty_ordered', 'custcol_core_qty_received',
          'custcol_starter_model', 'custcol_serial_number', 'internalid'
        ]
      });

      soSearch.run().each(function(r) {
        var tranDate  = r.getValue('trandate');
        var daysOut   = daysBetween(tranDate);
        var fee       = parseFloat(r.getValue('rate')) || 0;
        var ci        = creditInfo(daysOut, fee);

        var qtyOrdered   = parseInt(r.getValue('custcol_core_qty_ordered'))  || parseInt(r.getValue('quantity')) || 1;
        var qtyReceived  = parseInt(r.getValue('custcol_core_qty_received')) || 0;
        var qtyRemaining = Math.max(0, qtyOrdered - qtyReceived);

        // Only include lines that still have cores outstanding
        if (qtyRemaining <= 0) return true; // skip fully received lines

        results.push({
          soId          : r.getValue('internalid'),
          soNumber      : r.getValue('tranid'),
          customer      : r.getText('entity'),
          saleDate      : tranDate,
          daysOut       : daysOut,
          item          : r.getText('item'),
          starterModel  : r.getValue('custcol_starter_model'),
          serialNumber  : r.getValue('custcol_serial_number'),
          coreFee       : fee,
          creditAmount  : ci.amount,
          creditLabel   : ci.label,
          lineNum       : r.getValue('line'),
          coreReceived  : r.getValue('custcol_core_received') === 'T',
          qtyOrdered    : qtyOrdered,
          qtyReceived   : qtyReceived,
          qtyRemaining  : qtyRemaining
        });
        return true;
      });

      return { success: true, count: results.length, cores: results };

    } catch (e) {
      log.error({ title: 'GET Error', details: e });
      return { success: false, error: e.message };
    }
  }

  // ─── POST: Process a core receipt ──────────────────────────────────────────
  function doPost(body) {
    try {
      var workflow     = body.workflow || 'bin_pickup'; // 'bin_pickup' | 'bank_draw'
      var soId         = body.soId;
      var lineNum      = body.lineNum;
      var serialNum    = body.serialNumber    || '';
      var destination  = body.destination    || 'MASCO';
      var receivedBy   = body.receivedBy     || '';
      var coreFee      = parseFloat(body.coreFee)     || 0;
      var creditAmount = parseFloat(body.creditAmount) || 0;
      var creditLabel  = body.creditLabel    || '';
      var daysOut      = parseInt(body.daysOut)        || 0;
      var saleDate     = body.saleDate       || '';
      var customer     = body.customer       || '';
      var starterModel = body.starterModel   || '';
      var soNumber     = body.soNumber       || '';

      // Core Bank record fields (from customer Core Bank tab)
      var coreBankRecordId = body.coreBankRecordId || null; // internal ID of the Starter Core record

      if (!soId) return { success: false, error: 'soId is required' };

      var results = {};

      // ── 1. Mark the Sales Order line as Core Received ──────────────────────
      var soRec = record.load({
        type: record.Type.SALES_ORDER,
        id: soId,
        isDynamic: true
      });

      var lineCount = soRec.getLineCount({ sublistId: 'item' });
      var lineFound = false;

      for (var i = 0; i < lineCount; i++) {
        var ln = soRec.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });
        if (String(ln) === String(lineNum)) {
          soRec.selectLine({ sublistId: 'item', line: i });

          // Increment qty_received by 1
          var currentQtyReceived = parseInt(soRec.getCurrentSublistValue({
            sublistId: 'item', fieldId: 'custcol_core_qty_received'
          })) || 0;
          var currentQtyOrdered = parseInt(soRec.getCurrentSublistValue({
            sublistId: 'item', fieldId: 'custcol_core_qty_ordered'
          })) || parseInt(soRec.getCurrentSublistValue({
            sublistId: 'item', fieldId: 'quantity'
          })) || 1;

          var newQtyReceived = currentQtyReceived + 1;
          var allReceived    = newQtyReceived >= currentQtyOrdered;

          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_core_qty_received',  value: newQtyReceived });
          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_core_received_date',  value: new Date()    });
          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_core_destination',    value: destination   });

          // Only mark fully received when all cores are in
          if (allReceived) {
            soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_core_received', value: true });
          }

          if (serialNum) {
            // Append serial to existing serials (comma separated) so we track all of them
            var existingSerials = soRec.getCurrentSublistValue({
              sublistId: 'item', fieldId: 'custcol_serial_number'
            }) || '';
            var updatedSerials = existingSerials
              ? existingSerials + ', ' + serialNum
              : serialNum;
            soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_serial_number', value: updatedSerials });
          }

          soRec.commitLine({ sublistId: 'item' });
          lineFound = true;

          // Pass qty info back for email and response
          body._qtyOrdered   = currentQtyOrdered;
          body._qtyReceived  = newQtyReceived;
          body._qtyRemaining = Math.max(0, currentQtyOrdered - newQtyReceived);
          body._allReceived  = allReceived;
          break;
        }
      }

      if (!lineFound) {
        return { success: false, error: 'Could not find matching line ' + lineNum + ' on SO ' + soId };
      }

      var savedSoId = soRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
      results.soUpdated = true;
      results.soId = savedSoId;
      log.audit({ title: 'SO core received stamped', details: soNumber + ' | ' + destination });

      // ── 2. Mark linked Invoice as Core Received ────────────────────────────
      var invoiceId = null;
      try {
        var invSearch = search.create({
          type: search.Type.INVOICE,
          filters: [
            ['createdfrom', 'anyof', soId],
            'AND', ['mainline', 'is', 'T']
          ],
          columns: ['internalid', 'tranid']
        });
        var invResults = invSearch.run().getRange({ start: 0, end: 1 });
        if (invResults.length > 0) {
          invoiceId = invResults[0].getValue('internalid');
          var invNumber = invResults[0].getValue('tranid');

          // Stamp core received on invoice header custom field if it exists
          try {
            record.submitFields({
              type: record.Type.INVOICE,
              id: invoiceId,
              values: {
                custbody_core_received      : true,
                custbody_core_received_date : new Date()
              },
              options: { enableSourcing: true, ignoreMandatoryFields: true }
            });
            results.invoiceUpdated = true;
            results.invoiceId = invoiceId;
            log.audit({ title: 'Invoice core received stamped', details: invNumber });
          } catch (invFieldErr) {
            // Custom fields may not exist on Invoice — non-fatal
            log.error({ title: 'Invoice field stamp skipped', details: invFieldErr.message });
            results.invoiceUpdated = false;
            results.invoiceNote = 'Custom fields not found on Invoice — stamp skipped';
          }
        }
      } catch (invErr) {
        log.error({ title: 'Invoice lookup error', details: invErr.message });
        results.invoiceUpdated = false;
      }

      // ── 3. Mark linked Quote as Core Received (if applicable) ──────────────
      try {
        var quoteSearch = search.create({
          type: search.Type.ESTIMATE,
          filters: [
            ['createdfrom', 'anyof', soId],
            'AND', ['mainline', 'is', 'T']
          ],
          columns: ['internalid', 'tranid']
        });
        var quoteResults = quoteSearch.run().getRange({ start: 0, end: 1 });
        if (quoteResults.length > 0) {
          var quoteId     = quoteResults[0].getValue('internalid');
          var quoteNumber = quoteResults[0].getValue('tranid');
          try {
            record.submitFields({
              type: record.Type.ESTIMATE,
              id: quoteId,
              values: { custbody_core_received: true, custbody_core_received_date: new Date() },
              options: { enableSourcing: true, ignoreMandatoryFields: true }
            });
            results.quoteUpdated = true;
            results.quoteId = quoteId;
            log.audit({ title: 'Quote core received stamped', details: quoteNumber });
          } catch (qFieldErr) {
            results.quoteUpdated = false;
          }
        }
      } catch (qErr) {
        log.error({ title: 'Quote lookup error', details: qErr.message });
        results.quoteUpdated = false;
      }

      // ── 4. Flip Core Bank record status to "Applied" ───────────────────────
      if (coreBankRecordId) {
        try {
          record.submitFields({
            type: 'customrecord_starter_core', // adjust to your actual custom record type ID
            id: coreBankRecordId,
            values: {
              custrecord_core_status           : 'Applied', // adjust to your field ID
              custrecord_core_applied_so       : soId,
              custrecord_core_applied_date     : new Date(),
              custrecord_core_applied_by       : receivedBy
            },
            options: { enableSourcing: true, ignoreMandatoryFields: true }
          });
          results.coreBankUpdated = true;
          log.audit({ title: 'Core Bank record flipped to Applied', details: coreBankRecordId });
        } catch (cbErr) {
          log.error({ title: 'Core Bank record update error', details: cbErr.message });
          results.coreBankUpdated = false;
          results.coreBankNote = cbErr.message;
        }
      }

      // ── 5. Send credit notification email to AP/AR (bin_pickup only) ────────
      if (workflow === 'bin_pickup') {
        try {
          var qtyOrdered   = body._qtyOrdered   || 1;
          var qtyReceived  = body._qtyReceived  || 1;
          var qtyRemaining = body._qtyRemaining || 0;
          var allReceived  = body._allReceived  || false;

          // Credit amount is per-core (fee / qty ordered)
          var perCoreFee    = coreFee / qtyOrdered;
          var perCoreCredit = creditAmount / qtyOrdered;

          var emailBody = buildCreditEmail({
            customer     : customer,
            soNumber     : soNumber,
            invoiceId    : invoiceId,
            starterModel : starterModel,
            serialNumber : serialNum,
            dateReceived : fmtDate(new Date()),
            saleDate     : fmtDate(saleDate),
            daysOut      : daysOut,
            coreFee      : fmtCurr(perCoreFee),
            creditAmount : fmtCurr(perCoreCredit),
            creditLabel  : creditLabel,
            destination  : destination,
            receivedBy   : receivedBy,
            qtyOrdered   : qtyOrdered,
            qtyReceived  : qtyReceived,
            qtyRemaining : qtyRemaining,
            allReceived  : allReceived
          });

          email.send({
            author    : runtime.getCurrentUser().id,
            recipients: [APAR_EMAIL],
            subject   : (body._allReceived ? 'Core Return Credit Required' : 'Partial Core Return (' + body._qtyReceived + '/' + body._qtyOrdered + ')') + ' \u2014 ' + customer + ' | ' + soNumber,
            body      : emailBody
          });

          results.emailSent = true;
          results.emailTo   = APAR_EMAIL;
          log.audit({ title: 'Credit notification email sent', details: APAR_EMAIL + ' | ' + soNumber });

        } catch (emailErr) {
          log.error({ title: 'Email send error', details: emailErr.message });
          results.emailSent  = false;
          results.emailError = emailErr.message;
        }
      } else {
        // bank_draw — no email, no credit
        results.emailSent = false;
        results.emailNote = 'bank_draw workflow — no credit notification needed';
      }

      return {
        success  : true,
        workflow : workflow,
        results  : results,
        message  : buildSuccessMessage(workflow, results)
      };

    } catch (e) {
      log.error({ title: 'POST Error', details: e });
      return { success: false, error: e.message };
    }
  }

  // ─── Email builder ─────────────────────────────────────────────────────────
  function buildCreditEmail(d) {
    return [
      '<html><body style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;">',

      '<div style="background:#0f1923;padding:20px 24px;border-radius:8px 8px 0 0;">',
      '  <span style="color:#00d4aa;font-size:20px;font-weight:bold;">CVIS Core Tracker</span>',
      '  <span style="color:#7a9bb5;font-size:13px;margin-left:12px;">Credit Notification</span>',
      '</div>',

      '<div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:24px;">',

      '<p style="font-size:15px;margin-bottom:20px;">',
      'A core has been received and logged in the CVIS Core Tracker. ',
      'Please apply the appropriate credit to the customer\'s account in NetSuite.',
      '</p>',

      '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">',
        row('Customer',          d.customer),
        row('Sales Order',       '<strong>' + d.soNumber + '</strong>'),
        row('Starter Model',     d.starterModel || '—'),
        row('Serial Number',     d.serialNumber || '—'),
        row('Date Received',     d.dateReceived),
        row('Original Sale',     d.saleDate),
        row('Days Since Sale',   '<strong>' + d.daysOut + ' days</strong>'),
        row('Cores on Order',    d.qtyOrdered + ' total'),
        row('Cores Received',    '<strong>' + d.qtyReceived + ' of ' + d.qtyOrdered + '</strong>' + (d.allReceived ? ' &nbsp;<span style="color:#15803d">✓ All received</span>' : ' &nbsp;<span style="color:#b45309">(' + d.qtyRemaining + ' still outstanding)</span>')),
        row('Destination',       d.destination),
        row('Received By',       d.receivedBy || '—'),
      '</table>',

      '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:16px;margin-bottom:20px;">',
      '  <div style="font-size:12px;color:#166534;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recommended credit amount</div>',
      '  <div style="font-size:28px;font-weight:bold;color:#15803d;">' + d.creditAmount + '</div>',
      '  <div style="font-size:12px;color:#166534;margin-top:4px;">' + d.creditLabel + ' &nbsp;|&nbsp; Original core fee: ' + d.coreFee + '</div>',
      '</div>',

      '<p style="font-size:13px;color:#666;border-top:1px solid #eee;padding-top:16px;margin-top:0;">',
      'This is an automated notification from the CVIS Core Tracker. ',
      'The credit amount shown is a recommendation based on the 30-day policy. ',
      'Please verify against the original sales order before applying.',
      '</p>',

      '</div>',
      '</body></html>'
    ].join('\n');
  }

  function row(label, value) {
    return [
      '<tr style="border-bottom:1px solid #f0f0f0;">',
      '  <td style="padding:8px 12px 8px 0;color:#666;white-space:nowrap;width:140px;">' + label + '</td>',
      '  <td style="padding:8px 0;">' + value + '</td>',
      '</tr>'
    ].join('');
  }

  function buildSuccessMessage(workflow, results) {
    var parts = [];
    if (results.soUpdated)        parts.push('Sales Order marked Core Received');
    if (results.invoiceUpdated)   parts.push('Invoice stamped');
    if (results.quoteUpdated)     parts.push('Quote stamped');
    if (results.coreBankUpdated)  parts.push('Core Bank record set to Applied');
    if (results.emailSent)        parts.push('Credit notification sent to ' + APAR_EMAIL);
    if (!results.emailSent && workflow === 'bin_pickup') parts.push('Email failed — check Script Execution Log');
    if (workflow === 'bank_draw') parts.push('No credit email (bank draw — customer not charged upfront)');
    return parts.join(' \u2022 ');
  }

  return { get: doGet, post: doPost };
});
