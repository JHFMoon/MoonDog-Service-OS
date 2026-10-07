const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const maintenance=require("../assets/maintenance.js");

const R=maintenance.retention;
assert.deepEqual(
  {
    automaticDays:R.automaticDays,automaticMax:R.automaticMax,
    fullRecentDays:R.fullRecentDays,fullMonthlyMonths:R.fullMonthlyMonths,fullMax:R.fullMax,fullRefreshDays:R.fullRefreshDays,
    restoreSafetyDays:R.restoreSafetyDays,restoreSafetyMax:R.restoreSafetyMax,
    systemUpdateDays:R.systemUpdateDays,systemUpdateMax:R.systemUpdateMax
  },
  {automaticDays:30,automaticMax:50,fullRecentDays:30,fullMonthlyMonths:12,fullMax:3,fullRefreshDays:30,restoreSafetyDays:30,restoreSafetyMax:2,systemUpdateDays:30,systemUpdateMax:3}
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
  const recent=[1,5,10,15,20,25,29].map((n)=>file(`backups/MoonDog Full Backup - recent-${n}.zip`,"manager-full",n,{family:"manager-full",createdAt:now-n*86400000}));
  assert.equal(maintenance.policy(recent,ctx).length,0,"all validated full backups from the last 30 days must be retained");
}
{
  const full=[
    file("backups/MoonDog Full Backup - 2026-10-06.zip","manager-full",1,{family:"manager-full",createdAt:Date.parse("2026-10-06T12:00:00Z")}),
    file("backups/MoonDog Full Backup - 2026-10-05.zip","manager-full",2,{family:"manager-full",createdAt:Date.parse("2026-10-05T12:00:00Z")}),
    file("backups/MoonDog Full Backup - 2026-10-04.zip","manager-full",3,{family:"manager-full",createdAt:Date.parse("2026-10-04T12:00:00Z")}),
    file("backups/MoonDog Full Backup - 2026-08-25.zip","manager-full",43,{family:"manager-full",createdAt:Date.parse("2026-08-25T12:00:00Z")}),
    file("backups/MoonDog Full Backup - 2026-08-05.zip","manager-full",63,{family:"manager-full",createdAt:Date.parse("2026-08-05T12:00:00Z")})
  ];
  const removed=maintenance.policy(full,ctx).map(x=>x.path);
  assert(!removed.includes(full[3].path),"the newest validated full backup in a retained month must be kept");
  assert(removed.includes(full[4].path),"older same-month full backups may be pruned after 30 days");
}
{
  const lone=file("backups/MoonDog Full Backup - lone-old.zip","manager-full",500,{family:"manager-full",createdAt:now-500*86400000});
  assert.equal(maintenance.policy([lone],ctx).length,0,"the only validated full backup must never be pruned");
}
{
  const full=[
    file("backups/MoonDog Full Backup - newest-1.zip","manager-full",1,{family:"manager-full",createdAt:now-1*86400000}),
    file("backups/MoonDog Full Backup - newest-2.zip","manager-full",2,{family:"manager-full",createdAt:now-2*86400000}),
    file("backups/MoonDog Full Backup - newest-3.zip","manager-full",3,{family:"manager-full",createdAt:now-3*86400000}),
    file("backups/MoonDog Full Backup - eleven-month-anchor.zip","manager-full",330,{family:"manager-full",createdAt:now-330*86400000}),
    file("backups/MoonDog Full Backup - outside-window.zip","manager-full",400,{family:"manager-full",createdAt:now-400*86400000})
  ];
  const removed=maintenance.policy(full,ctx).map(x=>x.path);
  assert(!removed.includes(full[3].path),"one monthly full-backup recovery point must be retained through the 12-month window");
  assert(removed.includes(full[4].path),"full backups outside the 12-month monthly window may expire when newer validated full backups exist");
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
