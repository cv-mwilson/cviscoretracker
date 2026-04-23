/**
 * CVIS Core Tracker — NetSuite SuiteScript 2.0 RESTlet
 * File: cvis_core_restlet.js
 * Deploy as: RESTlet (Script Type: RESTlet)
 *
 * Workflows:
 *   "bin_pickup" — Core collected from customer's bin, physically arriving at CVIS shop.
 *                  Marks SO/Invoice/Quote received, flips Core Bank status to Applied.
 *                  Credit memo handled separately by auto_core_credit.js.
 *
 *   "bank_draw"  — Core already at CVIS (right container), being pulled for a new sales order.
 *                  Marks new SO as Core Received, flips Core Bank status to Applied.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/runtime', 'N/log', 'N/format'],
function(search, record, runtime, log, format) {

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
        type: search.Type.INVOICE,
        filters: [
          ['mainline',              'is',      'F'],
          'AND', ['item',           'contains', 'CORE CHARGE'],
          'AND', ['status',         'anyof',   'CustInvc:A'],
          'AND', [
            ['custcol3', 'is',      'F'],
            'OR',
            ['custcol3', 'isempty', '']
          ]
        ],
        columns: [
          'tranid', 'entity', 'trandate', 'item', 'rate', 'line', 'quantity',
          'custcol3', 'internalid'
        ]
      });

      soSearch.run().each(function(r) {
        var tranDate  = r.getValue('trandate');
        var daysOut   = daysBetween(tranDate);
        var fee       = parseFloat(r.getValue('rate')) || 0;
        var ci        = creditInfo(daysOut, fee);

        var qtyOrdered   = parseInt(r.getValue('quantity')) || 1;
        var qtyRemaining = qtyOrdered;

        results.push({
          soId         : r.getValue('internalid'),
          soNumber     : r.getValue('tranid'),
          customer     : r.getText('entity'),
          saleDate     : tranDate,
          daysOut      : daysOut,
          item         : r.getText('item'),
          starterModel : '',
          serialNumber : '',
          coreFee      : fee,
          creditAmount : ci.amount,
          creditLabel  : ci.label,
          lineNum      : r.getValue('line'),
          coreReceived : false,
          qtyOrdered   : qtyOrdered,
          qtyReceived  : 0,
          qtyRemaining : qtyRemaining
        });
        return true;
      });

      // ── Incoming cores: open Sales Orders with unreceived CORE CHARGE lines ───
      var incomingResults = [];
      try {
        var soSearch2 = search.create({
          type: search.Type.SALES_ORDER,
          filters: [
            ['mainline',              'is',      'F'],
            'AND', ['item',           'contains', 'CORE CHARGE'],
            'AND', ['status',         'anyof',   'SalesOrd:B','SalesOrd:D','SalesOrd:E','SalesOrd:F'],
            'AND', [
              ['custcol3', 'is',      'F'],
              'OR',
              ['custcol3', 'isempty', '']
            ]
          ],
          columns: [
            'tranid', 'entity', 'trandate', 'item', 'rate', 'line', 'quantity',
            'custcol3', 'custcol2',
            'custcol_core_qty_ordered', 'custcol_core_qty_received',
            'custcol_starter_model', 'custcol_serial_number', 'internalid'
          ]
        });
        soSearch2.run().each(function(r) {
          var tranDate  = r.getValue('trandate');
          var daysOut   = daysBetween(tranDate);
          var fee       = parseFloat(r.getValue('rate')) || 0;
          var ci        = creditInfo(daysOut, fee);
          var qtyOrdered   = parseInt(r.getValue('custcol_core_qty_ordered'))  || parseInt(r.getValue('quantity')) || 1;
          var qtyReceived  = parseInt(r.getValue('custcol_core_qty_received')) || 0;
          var qtyRemaining = Math.max(0, qtyOrdered - qtyReceived);
          if (qtyRemaining <= 0) return true;
          incomingResults.push({
            soId         : r.getValue('internalid'),
            soNumber     : r.getValue('tranid'),
            customer     : r.getText('entity'),
            saleDate     : tranDate,
            daysOut      : daysOut,
            item         : r.getText('item'),
            starterModel : r.getValue('custcol_starter_model'),
            serialNumber : r.getValue('custcol_serial_number'),
            coreFee      : fee,
            creditAmount : ci.amount,
            creditLabel  : ci.label,
            lineNum      : r.getValue('line'),
            coreReceived : r.getValue('custcol3') === 'T',
            qtyOrdered   : qtyOrdered,
            qtyReceived  : qtyReceived,
            qtyRemaining : qtyRemaining
          });
          return true;
        });
      } catch (soErr) {
        log.error({ title: 'Incoming SO search error', details: soErr.message });
      }

      // ── Banked cores: customrecord1532 where no Applied SO yet ────────────────
      var banked = [];
      try {
        var bankSearch = search.create({
          type: 'customrecord1532',
          filters: [
            ['custrecord174', 'isempty', ''] // Applied Sales Order is empty = still available
          ],
          columns: [
            'internalid',
            'custrecord168', // Starter Model
            'custrecord169', // Serial Number
            'custrecord170', // Date Received
            'custrecord171', // Status
            'custrecord173', // Notes
            'custrecord175', // Core Owner (corp)
            'custrecord193'  // ACS / Customer
          ]
        });

        bankSearch.run().each(function(r) {
          banked.push({
            id          : r.getValue('internalid'),
            customer    : r.getText('custrecord193') || r.getValue('custrecord193') || '',
            corp        : r.getText('custrecord175') || r.getValue('custrecord175') || '',
            model       : r.getValue('custrecord168') || '',
            serial      : r.getValue('custrecord169') || '',
            dateCreated : r.getValue('custrecord170') || '',
            status      : r.getText('custrecord171')  || r.getValue('custrecord171') || '',
            notes       : r.getValue('custrecord173') || ''
          });
          return true;
        });
      } catch (bankErr) {
        log.error({ title: 'Banked cores search error', details: bankErr.message });
      }

      return { success: true, count: results.length, cores: results, incoming: incomingResults, banked: banked };

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

      // ── 1. Mark the transaction line as Core Received ─────────────────────
      var recType = body.recordType === 'invoice' ? record.Type.INVOICE : record.Type.SALES_ORDER;
      var soRec = record.load({
        type: recType,
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
          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_core_destination',    value: destination   });

          // Only mark fully received when all cores are in
          if (allReceived) {
            soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol3',  value: true      });
            soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol2',  value: new Date() });
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

          // Pass qty info back for response
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

      // ── 2 & 3. Stamp linked Invoice / Quote (Sales Order workflow only) ───────
      if (body.recordType !== 'invoice') {

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

      } // end SO-only steps 2 & 3

      // ── 4. Flip Core Bank record status to "Applied" ───────────────────────
      if (coreBankRecordId) {
        try {
          record.submitFields({
            type: 'customrecord1532',
            id: coreBankRecordId,
            values: {
              custrecord171 : 'Applied',  // Status
              custrecord174 : soId        // Applied Sales Order
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

  function buildSuccessMessage(workflow, results) {
    var parts = [];
    if (results.soUpdated)        parts.push('Sales Order marked Core Received');
    if (results.invoiceUpdated)   parts.push('Invoice stamped');
    if (results.quoteUpdated)     parts.push('Quote stamped');
    if (results.coreBankUpdated)  parts.push('Core Bank record set to Applied');
    return parts.join(' \u2022 ');
  }

  return { get: doGet, post: doPost };
});
