const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const maintenance=require("../assets/maintenance.js");

const R=maintenance.retention;
assert.deepEqual(
  {
    automaticDays:R.automaticDays,automaticMax:R.automaticMax,
    fullDays:R.fullDays,fullMax:R.fullMax,fullRefreshDays:R.fullRefreshDays,
    restoreSafetyDays:R.restoreSafetyDays,restoreSafetyMax:R.restoreSafetyMax,
    systemUpdateDays:R.systemUpdateDays,systemUpdateMax:R.systemUpdateMax
  },
  {automaticDays:30,automaticMax:50,fullDays:90,fullMax:3,fullRefreshDays:30,restoreSafetyDays:30,restoreSafetyMax:2,systemUpdateDays:30,systemUpdateMax:3}
);

const now=Date.parse("2026-10-07T12:00:00Z");
const day="2026-10-07";
const file=(pathName,area,daysAgo,extra={})=>({
  path:pathName,area,valid:true,
  modified:now-daysAgo*86400000,
  day:new Date(now-daysAgo*86400000).toISOString().slice(0,10),
  ...extra
});
const ctx={now,day,references:[],currentValid:true,restoreBusy:false,currentWorkbookValid:true,fullBackups:[]};

{
  const full=[0,1,2,3].map((n)=>file(`backups/MoonDog Full Backup - 2026-10-0${7-n}.zip`,"manager-full",n,{family:"manager-full"}));
  const removed=maintenance.policy(full,ctx).map(x=>x.path);
  assert.equal(removed.length,1,"manager full backups must be capped at three");
  assert.equal(removed[0],full[3].path);
}
{
  const stale=file("backups/MoonDog Full Backup - old.zip","manager-full",91,{family:"manager-full"});
  assert.deepEqual(maintenance.policy([stale],ctx).map(x=>x.path),[stale.path],"full backups older than 90 days must expire when unpinned");
}
{
  const updates=[0,1,2,3].map((n)=>file(`backups/system-updates/update-${n}`,"system-update",n));
  const unresolved=file("backups/system-updates/recovery-active","system-update",45,{unresolved:true});
  const removed=maintenance.policy([...updates,unresolved],ctx).map(x=>x.path);
  assert(removed.includes(updates[3].path),"resolved update rollbacks must be capped at three");
  assert(!removed.includes(unresolved.path),"active interrupted-update recovery must never be pruned as ordinary retention");
}
{
  const oldUpdate=file("backups/system-updates/update-old","system-update",31);
  assert.deepEqual(maintenance.policy([oldUpdate],ctx).map(x=>x.path),[oldUpdate.path],"resolved update rollback must expire after 30 days");
}
{
  const auto=Array.from({length:51},(_,i)=>file(`backups/2026-10-07-before-test-${String(i).padStart(2,"0")}.json`,"automatic",0,{family:"before-test"}));
  assert.equal(maintenance.policy(auto,ctx).length,1,"automatic pre-change backups must be capped at 50");
  const old=file("backups/2026-09-06-before-test.json","automatic",31,{family:"before-test"});
  assert(maintenance.policy([old],ctx).some(x=>x.path===old.path),"automatic pre-change backups must expire after 30 days");
}
{
  const restore=[0,1,2].map((n)=>file(`backups/MoonDog Restore Safety - ${n}.zip`,"restore-safety",n));
  assert.equal(maintenance.policy(restore,ctx).length,1,"restore safety backups must be capped at two");
}
{
  const candidate=file("backups/2026-01-01-before-test.json","automatic",200,{family:"before-test"});
  assert.equal(maintenance.policy([candidate],{...ctx,currentValid:false}).length,0,"retention must stop when current durable state cannot be validated");
}

const app=fs.readFileSync(path.join(__dirname,"..","assets","app.js"),"utf8");
const settings=fs.readFileSync(path.join(__dirname,"..","assets","moondog-update-settings.js"),"utf8");
assert(app.includes("Automatic rolling retention backup"),"runtime must refresh a verified rolling full backup");
assert(app.includes("Rolling retention: full backups"),"retention limits must be visible in Backup & Recovery");
assert(settings.includes("state.hasRecoverable || !currentOffer()"),"a second update must be blocked while interrupted recovery exists");

console.log("PASS bounded backup retention policy");
