const axios           = require('axios');
const randomUseragent = require('random-useragent');
const cache           = require('./cache');
const dataHelper      = require('./data')(axios, randomUseragent, cache);

const gameWeek = 6;

console.debug = () => {};

const run = async () => {
    const bootstrapData = await dataHelper.getBootstrapData();
    const topTeamPicks  = await dataHelper.getTopTeamPicks(gameWeek - 1, 10);
    const fixtures      = await dataHelper.getFixtures(gameWeek);
    const players       = dataHelper.getPlayerData(bootstrapData, topTeamPicks, fixtures);
    const team          = dataHelper.pickTeam(players);
    // const team          = dataHelper.getTopPickedTeam(players);

    console.log(team);
};

run();