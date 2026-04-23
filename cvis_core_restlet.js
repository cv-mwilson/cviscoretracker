/**
 * CVIS Core Tracker — NetSuite SuiteScript 2.0 RESTlet
 * File: cvis_core_restlet.js
 * Deploy as: RESTlet (Script Type: RESTlet)
 *
 * Workflows:
 *   "bin_pickup" — Core collected from customer's bin, physically arriving at CVIS shop.
 *                  Marks Invoice/SO received, flips Core Bank status to Applied.
 *                  Credit memo handled separately by auto_core_credit.js.
 *
 *   "bank_draw"  — Core already at CVIS (right container), being pulled for a new sales order.
 *                  Marks new SO as Core Received, flips Core Bank status to Applied.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/log'],
function(search, record, log) {

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

  function modelFromItem(itemText) {
    return (itemText || '').replace(/\s*-?\s*CORE CHARGE.*/i, '').trim();
  }

  // ─── GET: Pull outstanding core charge lines ────────────────────────────────
  function doGet(params) {
    try {
      var results = [];

      var soSearch = search.create({
        type: search.Type.INVOICE,
        filters: [
          ['mainline',          'is',      'F'],
          'AND', ['status',     'anyof',   'CustInvc:A'],
          'AND', [
            ['custcol3', 'is',      'F'],
            'OR',
            ['custcol3', 'isempty', '']
          ]
        ],
        columns: [
          'tranid', 'entity', 'trandate', 'item', 'rate', 'line', 'quantity', 'internalid', 'createdfrom'
        ]
      });

      var createdFromIds = [];
      try {
        soSearch.run().each(function(r) {
          if ((r.getText('item') || '').toUpperCase().indexOf('CORE CHARGE') === -1) return true;
          var itemText  = r.getText('item') || '';
          var tranDate  = r.getValue('trandate');
          var daysOut   = daysBetween(tranDate);
          var fee       = parseFloat(r.getValue('rate')) || 0;
          var ci        = creditInfo(daysOut, fee);
          var qty       = parseInt(r.getValue('quantity')) || 1;
          var cfId      = r.getValue('createdfrom') || '';
          if (cfId) createdFromIds.push(cfId);
          results.push({
            soId         : r.getValue('internalid'),
            soNumber     : r.getValue('tranid'),
            customer     : r.getText('entity'),
            saleDate     : tranDate,
            daysOut      : daysOut,
            item         : itemText,
            starterModel : modelFromItem(itemText),
            coreFee      : fee,
            creditAmount : ci.amount,
            creditLabel  : ci.label,
            lineNum      : r.getValue('line'),
            coreReceived : false,
            qtyOrdered   : qty,
            qtyReceived  : 0,
            qtyRemaining : qty,
            createdFrom  : r.getText('createdfrom') || '',
            _createdFromId: cfId,
            binPickup    : false
          });
          return true;
        });
      } catch(invErr) { log.error({ title: 'Invoice search error', details: invErr.message }); }

      // ── Look up custbody75 on the linked Sales Orders ─────────────────────────
      if (createdFromIds.length > 0) {
        try {
          var binSet = {};
          search.create({
            type: search.Type.SALES_ORDER,
            filters: [
              ['internalid', 'anyof', createdFromIds],
              'AND', ['custbody75', 'is', 'T'],
              'AND', ['mainline', 'is', 'T']
            ],
            columns: ['internalid']
          }).run().each(function(r2) {
            binSet[r2.getValue('internalid')] = true;
            return true;
          });
          results.forEach(function(res) {
            if (res._createdFromId && binSet[res._createdFromId]) res.binPickup = true;
            delete res._createdFromId;
          });
        } catch(binErr) {
          log.error({ title: 'Bin pickup SO lookup error', details: binErr.message });
          results.forEach(function(res) { delete res._createdFromId; });
        }
      } else {
        results.forEach(function(res) { delete res._createdFromId; });
      }

      // ── Incoming cores: open Sales Orders with unreceived CORE CHARGE lines ───
      var incomingResults = [];
      try {
        var soSearch2 = search.create({
          type: search.Type.SALES_ORDER,
          filters: [
            ['mainline',              'is',      'F'],
            'AND', ['item.name',      'contains', 'CORE CHARGE'],
            'AND', ['status',         'anyof',   'SalesOrd:B','SalesOrd:D','SalesOrd:E','SalesOrd:F'],
            'AND', [
              ['custcol3', 'is',      'F'],
              'OR',
              ['custcol3', 'isempty', '']
            ]
          ],
          columns: [
            'tranid', 'entity', 'trandate', 'item', 'rate', 'line', 'quantity',
            'custcol3', 'custcol2', 'internalid', 'createdfrom'
          ]
        });
        soSearch2.run().each(function(r) {
          var tranDate = r.getValue('trandate');
          var daysOut  = daysBetween(tranDate);
          var fee      = parseFloat(r.getValue('rate')) || 0;
          var ci       = creditInfo(daysOut, fee);
          var qty      = parseInt(r.getValue('quantity')) || 1;
          var itemText2 = r.getText('item') || '';
          incomingResults.push({
            soId         : r.getValue('internalid'),
            soNumber     : r.getValue('tranid'),
            customer     : r.getText('entity'),
            saleDate     : tranDate,
            daysOut      : daysOut,
            item         : itemText2,
            starterModel : modelFromItem(itemText2),
            coreFee      : fee,
            creditAmount : ci.amount,
            creditLabel  : ci.label,
            lineNum      : r.getValue('line'),
            coreReceived : r.getValue('custcol3') === 'T',
            qtyOrdered   : qty,
            qtyReceived  : 0,
            qtyRemaining : qty,
            createdFrom  : r.getText('createdfrom') || ''
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
            ['custrecord174', 'isempty', '']
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
            model       : r.getText('custrecord168') || r.getValue('custrecord168') || '',
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

      // ── Warranty Bin: Support Cases where custevent2 = 1, category = Warranty/Root Cause ──
      var warrantyBin = [];
      try {
        var caseSearch = search.create({
          type: 'supportcase',
          filters: [
            ['custevent2',  'anyof',  '1'],
            'AND', ['category', 'anyof', '5', '7']
          ],
          columns: ['casenumber', 'company', 'quicknote', 'custevent_cv_items', 'internalid']
        });
        caseSearch.run().each(function(r) {
          warrantyBin.push({
            id         : r.getValue('internalid'),
            caseNumber : r.getValue('casenumber'),
            company    : r.getText('company')            || '',
            serialNum  : r.getValue('quicknote')          || '',
            items      : r.getValue('custevent_cv_items') || ''
          });
          return true;
        });
      } catch(wErr) {
        log.error({ title: 'Warranty bin search error', details: wErr.message });
      }

      return { success: true, count: results.length, cores: results, incoming: incomingResults, banked: banked, warrantyBin: warrantyBin };

    } catch (e) {
      log.error({ title: 'GET Error', details: e });
      return { success: false, error: e.message };
    }
  }

  // ─── POST: Process a core receipt ──────────────────────────────────────────
  function doPost(body) {
    try {
      var workflow         = body.workflow || 'bin_pickup';
      var soId             = body.soId;
      var lineNum          = body.lineNum;
      var soNumber         = body.soNumber       || '';
      var coreBankRecordId = body.coreBankRecordId || null;

      // ── case_move: flip custevent2 to 2 on a support case ─────────────────────
      if (workflow === 'case_move') {
        var caseId = body.caseId;
        if (!caseId) return { success: false, error: 'caseId is required' };
        record.submitFields({
          type: 'supportcase',
          id: caseId,
          values: { custevent2: '2' },
          options: { enableSourcing: true, ignoreMandatoryFields: true }
        });
        return { success: true, message: 'Case moved to next stage' };
      }

      if (!soId) return { success: false, error: 'soId is required' };

      var results = {};

      // ── 1. Mark the transaction line as Core Received ─────────────────────
      var recType = body.recordType === 'invoice' ? record.Type.INVOICE : record.Type.SALES_ORDER;
      var soRec = record.load({ type: recType, id: soId, isDynamic: true });

      var lineCount = soRec.getLineCount({ sublistId: 'item' });
      var lineFound = false;

      for (var i = 0; i < lineCount; i++) {
        var ln = soRec.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });
        if (String(ln) === String(lineNum)) {
          soRec.selectLine({ sublistId: 'item', line: i });
          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol3', value: true      });
          soRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol2', value: new Date() });
          soRec.commitLine({ sublistId: 'item' });
          lineFound = true;
          break;
        }
      }

      if (!lineFound) {
        return { success: false, error: 'Could not find matching line ' + lineNum + ' on record ' + soId };
      }

      soRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
      results.soUpdated = true;
      log.audit({ title: 'Core received stamped', details: soNumber });

      // ── 2. Flip Core Bank record status to "Applied" ───────────────────────
      if (coreBankRecordId) {
        try {
          record.submitFields({
            type: 'customrecord1532',
            id: coreBankRecordId,
            values: {
              custrecord171 : 'Applied',
              custrecord174 : soId
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
        message  : buildSuccessMessage(results)
      };

    } catch (e) {
      log.error({ title: 'POST Error', details: e });
      return { success: false, error: e.message };
    }
  }

  function buildSuccessMessage(results) {
    var parts = [];
    if (results.soUpdated)       parts.push('Core marked as received');
    if (results.coreBankUpdated) parts.push('Core Bank record set to Applied');
    return parts.join(' • ');
  }

  return { get: doGet, post: doPost };
});
