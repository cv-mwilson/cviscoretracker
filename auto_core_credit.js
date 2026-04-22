/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Title: Credit Memo Line Creator
 * Description: Automatically creates a Credit Memo line item when a custom line field 'custcol235' is checked on an Invoice.
 * Deployment: Deploy this script on the Invoice record type with the 'After Submit' event.
 */
define(['N/record', 'N/log', 'N/runtime'],
    /**
     * @param {N_record} record
     * @param {N_log} log
     * @param {N_runtime} runtime
     */
    (record, log, runtime) => {

        const PROCESSED_CHECKBOX_ID = 'custcol236'; // The new checkbox field to mark processed lines

        const afterSubmit = (scriptContext) => {
            // Check if the script is running in a context that involves user submission (Edit/Create).
            // This prevents running during mass updates, imports, or scheduled processes unless explicitly needed.
            if (scriptContext.type !== scriptContext.UserEventType.CREATE &&
                scriptContext.type !== scriptContext.UserEventType.EDIT) {
                log.debug('Context Skipped', `Event type is ${scriptContext.type}. Exiting script.`);
                return;
            }

            const newInvoice = scriptContext.newRecord;
            const invoiceId = newInvoice.id;
            const customerId = newInvoice.getValue({ fieldId: 'entity' });
            // The object now includes the original lineIndex for later update
            const creditLines = []; 

            try {
                // 1. ITERATE THROUGH INVOICE LINES TO FIND CHECKED, UNPROCESSED ITEMS
                const lineCount = newInvoice.getLineCount({ sublistId: 'item' });
                log.debug('Processing Invoice', `Invoice ID: ${invoiceId}, Customer ID: ${customerId}, Line Count: ${lineCount}`);

                for (let i = 0; i < lineCount; i++) {
                    const isCreditMemoRequired = newInvoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol235', // The trigger checkbox
                        line: i
                    });
                    
                    const isAlreadyProcessed = newInvoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: PROCESSED_CHECKBOX_ID, // The new processed marker
                        line: i
                    });

                    // Only process lines where the trigger box is checked AND the processed box is NOT checked
                    if (isCreditMemoRequired && !isAlreadyProcessed) {
                        const itemId = newInvoice.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                        const quantity = newInvoice.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                        const rate = newInvoice.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
                        const description = newInvoice.getSublistValue({ sublistId: 'item', fieldId: 'description', line: i });

                        log.audit('Line Found for Credit Memo', `Line ${i}: Item ID ${itemId}, Qty ${quantity}, Rate ${rate}`);

                        creditLines.push({
                            itemId: itemId,
                            quantity: quantity,
                            rate: rate,
                            description: description,
                            lineIndex: i // Store the original line index for updating the Invoice later
                        });
                    }
                }

                // 2. CREATE CREDIT MEMO IF UNPROCESSED LINES WERE FOUND
                if (creditLines.length > 0) {
                    const creditMemo = record.create({
                        type: record.Type.CREDIT_MEMO,
                        isDynamic: true 
                    });

                    // Set Header Fields
                    creditMemo.setValue({ fieldId: 'entity', value: customerId });
                    creditMemo.setValue({ fieldId: 'trandate', value: new Date() });
                    creditMemo.setValue({ fieldId: 'memo', value: `Auto-generated credit for Invoice #${newInvoice.getValue('tranid')} (Lines: ${creditLines.length})` });

                    // Add Line Items to Credit Memo
                    creditLines.forEach((lineData) => {
                        creditMemo.selectNewLine({ sublistId: 'item' });
                        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: lineData.itemId });
                        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: lineData.quantity });
                        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: lineData.rate });
                        creditMemo.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: lineData.description });
                        creditMemo.commitLine({ sublistId: 'item' });
                    });

                    // 3. SAVE THE CREDIT MEMO
                    const creditMemoId = creditMemo.save();
                    log.audit('Credit Memo Created Successfully', `New Credit Memo ID: ${creditMemoId} for Invoice ${invoiceId}.`);
                    
                    
                    // 4. UPDATE SOURCE INVOICE TO MARK LINES AS PROCESSED (custcol236 = true)
                    // Using isDynamic: false + setSublistValue to avoid re-triggering afterSubmit
                    try {
                        const invoiceToUpdate = record.load({
                            type: record.Type.INVOICE,
                            id: invoiceId,
                            isDynamic: false
                        });

                        creditLines.forEach((lineData) => {
                            invoiceToUpdate.setSublistValue({
                                sublistId: 'item',
                                fieldId: PROCESSED_CHECKBOX_ID,
                                line: lineData.lineIndex,
                                value: true
                            });
                        });

                        // Write credit memo ID back to invoice for traceability
                        // Requires a custom body field custbody_core_credit_memo (List/Record type pointing to Credit Memo)
                        invoiceToUpdate.setValue({ fieldId: 'custbody_core_credit_memo', value: creditMemoId });

                        // Note: to auto-apply this credit memo against the invoice, set applytransaction
                        // on the credit memo before saving — skip for now per AR workflow

                        const updatedInvoiceId = invoiceToUpdate.save({
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        });
                        log.audit('Invoice Updated', `Invoice ID ${updatedInvoiceId} marked ${creditLines.length} lines as processed. Credit Memo ID ${creditMemoId} linked.`);

                    } catch (updateError) {
                        log.error({
                            title: `Error marking Invoice lines as processed on ${invoiceId}`,
                            details: updateError.toString()
                        });
                    }

                } else {
                    log.debug('No Lines Found', 'No unprocessed lines with custcol235 checked. No Credit Memo created.');
                }

            } catch (e) {
                log.error({
                    title: `Error in primary Credit Memo creation logic for Invoice ${invoiceId}`,
                    details: e.toString()
                });
            }
        };

        return {
            afterSubmit: afterSubmit
        };
    });