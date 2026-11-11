// Articles sent through the site owner's connector go to a shared daily list,
// and every account picks the ones it wants to read.
export const POOL_OWNER = "gist-selfhost-owner";
export const PICKS_PER_DAY = 5;
export const taipeiToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
