const axios           = require('axios');
const randomUseragent = require('random-useragent');
const cache           = require('./cache');
const dataHelper      = require('./data')(axios, randomUseragent, cache);

const gameWeek = 4;

console.debug = () => {};

const run = async () => {
    const bootstrapData = await dataHelper.getBootstrapData();
    const topTeamPicks  = await dataHelper.getTopTeamPicks(gameWeek, 10);
    const players       = dataHelper.getPlayerData(bootstrapData, topTeamPicks);
    const team          = dataHelper.getTopPickedTeam(players);

    console.log(team);
};

run();