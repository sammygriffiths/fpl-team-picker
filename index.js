const axios            = require('axios');
const randomUseragent  = require('random-useragent');
const cache            = require('./cache');
const HttpsProxyAgent  = require('https-proxy-agent');
const config           = require('./config.json');
let proxy              = false;

if (!!config.proxy) {
    proxy = new HttpsProxyAgent(config.proxy);
}

const dataHelper = require('./data')(axios, randomUseragent, cache, proxy);

if (!config.debug) {
    console.debug = () => {};
}

const run = async () => {
    const cookies       = await dataHelper.login(config.email, config.password);
    const profile       = await dataHelper.getProfile(config.email, cookies);
    const myTeam        = await dataHelper.getMyTeam(profile.player.entry, cookies);
    const bootstrapData = await dataHelper.getBootstrapData();
    const topTeamPicks  = await dataHelper.getTopTeamPicks(config.gameWeek - 1, 10);
    const fixtures      = await dataHelper.getFixtures(config.gameWeek);
    const players       = dataHelper.getPlayerData(bootstrapData, topTeamPicks, fixtures);

    const suggestedTransfers = dataHelper.getSuggestedTransfers(myTeam, players, false);

    console.log(suggestedTransfers);
};

run();