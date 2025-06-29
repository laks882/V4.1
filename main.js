import { Actor } from 'apify';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Usage tracking configuration
const USAGE_UNIT_NAME = 'ENRICHED_RECORDS'; // Custom usage unit
const RECORDS_PER_UNIT = 1000; // Charge per 1000 records

// ✅ Helper function for sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const run = async () => {
    await Actor.init();

    const input = await Actor.getInput();

    const headers = {
        Authorization: `Bearer ${process.env.SEARCHLEADS_API_KEY}`,
        'Content-Type': 'application/json',
    };

    const startRes = await axios.post(
        process.env.SEARCHLEADS_API_URL,
        {
            apolloLink: input.apolloLink,
            noOfLeads: input.noOfLeads,
            fileName: input.fileName,
        },
        { headers }
    );

    const logId = startRes.data?.record_id;
    if (!logId) throw new Error('Failed to get LogID from enrichment request.');

    let result = null;
    let retries = 0;
    const maxRetries = 60;

    while (retries < maxRetries) {
        const statusRes = await axios.post(
            process.env.SEARCHLEADS_STATUS_URL,
            { record_id: logId }
        );

        // Handle both array and object responses
        const data = Array.isArray(statusRes.data) ? statusRes.data[0] : statusRes.data;
        const status = data?.enrichment_status;

        // Validate that we have valid data
        if (!data) {
            console.log('⚠️ Warning: No data received in status response');
            await sleep(10000);
            retries++;
            continue;
        }

        console.log(`Status: ${status} — Attempt ${retries + 1}/${maxRetries}`);

        // Debug: Log the raw response structure for troubleshooting
        if (retries === 0) {
            console.log('🔍 Raw status response structure:', JSON.stringify(statusRes.data, null, 2));
        }

        // Check for completion (case insensitive)
        if (status && status.toLowerCase() === 'completed') {
            result = data;
            console.log('✅ Enrichment completed successfully!');
            console.log('📊 Complete result data:', JSON.stringify(data, null, 2));
            break;
        }

        // Check for failure states (case insensitive)
        if (status && (status.toLowerCase() === 'failed' || status.toLowerCase() === 'cancelled')) {
            throw new Error(`Enrichment ${status}`);
        }

        await sleep(10000); // ✅ Replaces Actor.sleep
        retries++;
    }

    if (!result) throw new Error('Timed out waiting for enrichment result.');

    // Calculate usage based on enriched records
    const enrichedRecords = parseInt(result.enriched_records) || 0;
    const usageUnits = Math.ceil(enrichedRecords / RECORDS_PER_UNIT);

    console.log('💾 Saving final result to OUTPUT...');
    console.log('🎯 Final enrichment summary:');
    console.log(`   📊 Status: ${result.enrichment_status}`);
    console.log(`   📁 File: ${result.file_name}`);
    console.log(`   📈 Records enriched: ${result.enriched_records}`);
    console.log(`   💳 Credits used: ${result.credits_involved}`);
    console.log(`   🔗 Spreadsheet: ${result.spreadsheet_url}`);
    console.log(`   💰 Usage units charged: ${usageUnits} (${enrichedRecords} records / ${RECORDS_PER_UNIT} per unit)`);

    // Track usage for billing - this is what Apify will charge for
    if (enrichedRecords > 0) {
        await Actor.addUsage({
            unit: USAGE_UNIT_NAME,
            value: usageUnits
        });
        console.log(`✅ Usage tracked: ${usageUnits} units for ${enrichedRecords} enriched records`);
    } else {
        console.log('⚠️ No records enriched - no usage charged');
    }

    await Actor.setValue('OUTPUT', result);

    console.log('🎉 Actor completed successfully!');
    console.log('📋 You can access the enriched data at the spreadsheet URL above.');

    await Actor.exit();
};

run();

