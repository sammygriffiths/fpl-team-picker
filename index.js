const axios            = require('axios');
const cookieJarWrapper = require('axios-cookiejar-support').wrapper;
const randomUseragent  = require('random-useragent');
const cache            = require('./cache');
const dataHelper       = require('./data')(cookieJarWrapper(axios), randomUseragent, cache);
const config           = require('./config.json');

if (!config.debug) {
    console.debug = () => {};
}

const run = async () => {
    const cookies = await dataHelper.login(config.email, config.password);
    const profile = await dataHelper.getProfile(config.email, cookies);
    const myTeam = await dataHelper.getMyTeam(profile.player.entry, cookies);
    const bootstrapData = await dataHelper.getBootstrapData();
    const topTeamPicks  = await dataHelper.getTopTeamPicks(config.gameWeek - 1, 10);
    const fixtures      = await dataHelper.getFixtures(config.gameWeek);
    const players       = dataHelper.getPlayerData(bootstrapData, topTeamPicks, fixtures);

    const suggestedTransfers = dataHelper.getSuggestedTransfers(myTeam, players, false);

    console.log(suggestedTransfers);
};

run();