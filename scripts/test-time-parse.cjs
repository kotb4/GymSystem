const checkinStr = "2026-10-21 02:14:08";
const now = new Date();
const checkinDate = new Date(checkinStr.replace(" ", "T"));

console.log("now:", now.toISOString());
console.log("checkinDate:", checkinDate.toISOString());
console.log("elapsedMs:", now.getTime() - checkinDate.getTime());
console.log("elapsedMinutes:", (now.getTime() - checkinDate.getTime()) / (60 * 1000));
