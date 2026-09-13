const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateRecords,baseline,coveredRecord}=require('../app.js');
const reading=(previous,current,startMonth)=>({previous,current,...(startMonth?{startMonth}:{})});
test('Skipped September and October form one period and feed November',()=>{
 const records={'2026-08':{1:reading(80,100)},'2026-10':{1:reading(100,130,'2026-09')},'2026-11':{1:reading(130,140)}};
 validateRecords(records);
 assert.equal(baseline(records,'2026-10',1),100);
 assert.equal(baseline(records,'2026-11',1),130);
 assert.equal(coveredRecord(records,'2026-09',1).end,'2026-10');
 assert.equal(coveredRecord(records,'2026-10',1).end,'2026-10');
 assert.equal(coveredRecord(records,'2026-07',1),null);
 records['2026-08'][1].current=135;
 assert.throws(()=>validateRecords(records),/nhỏ hơn/);
});
test('Rejects overlapping periods, including a single month inside a period',()=>{
 assert.throws(()=>validateRecords({'2026-09':{1:reading(100,110)},'2026-10':{1:reading(100,130,'2026-09')}}),/trùng/);
 assert.throws(()=>validateRecords({'2026-10':{1:reading(100,130,'2026-08')},'2026-12':{1:reading(130,160,'2026-09')}}),/trùng/);
});
test('Supports year boundaries, old backups and rejects reversed ranges',()=>{
 const records={'2025-11':{1:reading(80,100)},'2026-01':{1:reading(100,130,'2025-12')}};
 validateRecords(JSON.parse(JSON.stringify(records)));
 assert.equal(baseline(records,'2026-01',1),100);
 assert.equal(coveredRecord(records,'2025-12',1).end,'2026-01');
 assert.throws(()=>validateRecords({'2026-01':{1:reading(100,130,'2026-02')}}),/bắt đầu/);
});
