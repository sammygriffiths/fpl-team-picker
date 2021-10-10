const apiBase           = 'https://fantasy.premierleague.com/api/';
const bootstrapEndpoint = 'bootstrap-static/';
const topTeamsEndpoint  = 'leagues-classic/314/standings/?page_standings=';
const teamPicksEndpoint = (entry, gameWeek) => `/entry/${entry}/event/${gameWeek}/picks/`;
const fixturesEndpoint  = 'fixtures/?event=';
const loginEndpoint     = 'https://users.premierleague.com/accounts/login/';
const profileEndpoint   = 'me/';
const myTeamEndpoint    = teamID => `my-team/${teamID}`;

module.exports = (axios, randomUseragent, cache, proxy) => {
    let axiosInstance = axios.create({
        baseURL: apiBase,
        headers: {
          'User-Agent': randomUseragent.getRandom(),
        },
        httpsAgent: proxy
    });

    const methods = {
        getBootstrapData: async () => {
            console.debug('Getting bootstrap data from cache');
            let bootstrapCache = cache('bootstrap');
            let bootstrapData  = bootstrapCache.get();
            
            if (bootstrapData === null) {
                console.debug('Cache expired, fetching bootstrap data from FPL API');
                bootstrapData = await axiosInstance.get(bootstrapEndpoint).then(response => response.data);
        
                console.debug('Saving bootstrap data to cache');
                bootstrapCache.set(bootstrapData);
                bootstrapCache.save();
            }
            
            return bootstrapData;
        },

        getTopTeams: async (pageLimit = 3) => {
            console.debug('Getting top team data from cache');
            let topTeamCache = cache('top_teams');
            let topTeamData  = topTeamCache.get();
            
            if (topTeamData === null) {
                console.debug('Cache expired, fetching top team data from FPL API');
                
                topTeamData = [];
                let pageData;

                for (let i = 1; i <= pageLimit; i++) {
                    pageData    = await axiosInstance.get(topTeamsEndpoint + i).then(response => response.data.standings.results);
                    topTeamData = topTeamData.concat(Object.values(pageData));
                }

                console.debug('Saving top team data to cache');
                topTeamCache.set(topTeamData, 86400000);
                topTeamCache.save();
            }
            
            return topTeamData;
        },

        getTeamPicks: async (entry, gameWeek) => {
            console.debug(`Getting team pick data from cache for entry ${entry} on gameweek ${gameWeek}`);
            let teamCache = cache(entry.toString());
            let teamData  = teamCache.get();
            
            if (teamData === null) {
                console.debug(`Cache expired, fetching team pick data for entry ${entry} on gameweek ${gameWeek} from FPL API`);

                teamData = await axiosInstance.get(teamPicksEndpoint(entry, gameWeek)).then(response => response.data.picks);

                console.debug(`Saving team pick data for entry ${entry} on gameweek ${gameWeek} to cache`);
                teamCache.set(teamData, 86400000);
                teamCache.save();
            }
            
            return teamData;
        },

        getTopTeamPicks: async (gameWeek, pageLimit = 3) => {
            const topTeams = await methods.getTopTeams(pageLimit);

            let promises = [];

            for (let i = 0; i < topTeams.length; i++) {
                const team = topTeams[i];
                promises.push(methods.getTeamPicks(team.entry, gameWeek));
            }

            return Promise.all(promises);
        },

        getFixtures: async gameWeek => {
            console.debug(`Getting fixture data from cache for gameweek ${gameWeek}`);
            let fixtureCache = cache('fixtures');
            let fixtureData  = fixtureCache.get();
            
            if (fixtureData === null) {
                console.debug(`Cache expired, fetching fixture data for gameweek ${gameWeek} from FPL API`);

                fixtureData = await axiosInstance.get(fixturesEndpoint + gameWeek).then(response => response.data);

                console.debug(`Saving fixture data for gameweek ${gameWeek} to cache`);
                fixtureCache.set(fixtureData, 86400000);
                fixtureCache.save();
            }
            
            return fixtureData;
        },

        getPlayerData: (bootstrapData, teamPicks, fixtures) => {
            let players = bootstrapData.elements;

            let enrichedPlayers = players.map(player => {
                let enrichedPlayer = {
                    'id': player.id,
                    'chance_of_playing_next_round': player.chance_of_playing_next_round,
                    'first_name': player.first_name,
                    'second_name': player.second_name,
                    'web_name': player.web_name,
                    'now_cost': player.now_cost,
                    'points_per_game': Number(player.points_per_game),
                    'team_code': player.team_code,
                    'total_points': player.total_points,
                    'transfers_in_event': player.transfers_in_event,
                    'transfers_out_event': player.transfers_out_event,
                    'value_season': Number(player.value_season),
                    'minutes': player.minutes,
                    'goals_scored': player.goals_scored,
                    'assists': player.assists,
                    'clean_sheets': player.clean_sheets,
                    'form': player.form,
                    'ict_index_rank': player.ict_index_rank,
                    'ict_index': Number(player.ict_index),
                    'news': player.news,
                };

                let teamsPickedBy = teamPicks.filter(team => {
                    return !!team.find(pickedPlayer => pickedPlayer.element === player.id);
                }).length;
                let teamsPickedByPercent = (teamsPickedBy / teamPicks.length) * 100;

                let teamsCaptainedBy = teamPicks.filter(team => {
                    return !!team.find(pickedPlayer => pickedPlayer.element === player.id && pickedPlayer.is_captain);
                }).length;
                let teamsCaptainedByPercent = (teamsCaptainedBy / teamPicks.length) * 100;

                enrichedPlayer['top_teams_selected_by_percent']  = Math.round(teamsPickedByPercent * 100) / 100;
                enrichedPlayer['top_teams_captained_by_percent'] = Math.round(teamsCaptainedByPercent * 100) / 100;
                enrichedPlayer['position']                       = bootstrapData.element_types.find(type => type.id === player.element_type).singular_name_short;
                
                let fixture = fixtures.find(fixture => fixture.team_h === player.team);
                
                if (typeof fixture !== 'undefined') {
                    enrichedPlayer['fixture_difficulty'] = fixture.team_h_difficulty
                    enrichedPlayer['opposing_team_fixture_difficulty'] = fixture.team_a_difficulty
                } else {
                    fixture = fixtures.find(fixture => fixture.team_a === player.team);
                    enrichedPlayer['fixture_difficulty'] = fixture.team_a_difficulty;
                    enrichedPlayer['opposing_team_fixture_difficulty'] = fixture.team_h_difficulty;
                }

                enrichedPlayer['team'] = bootstrapData.teams.find(team => player.team === team.id).name;

                return enrichedPlayer;
            });

            return enrichedPlayers.map(player => {
                return { ...player, desirability: methods.calculateDesirability(player, enrichedPlayers) }
            });
        },

        calculateDesirability: (player, players) => {
            const highestPPG  = methods.getHighestStat('points_per_game', players);
            const highestVS   = methods.getHighestStat('value_season', players);
            const highestTTSP = methods.getHighestStat('top_teams_selected_by_percent', players);
            const highestTTCP = methods.getHighestStat('top_teams_captained_by_percent', players);
            const highestTP   = methods.getHighestStat('total_points', players);
            const lowestFD    = methods.getLowestStat('fixture_difficulty', players);
            const highestOTFD = methods.getHighestStat('opposing_team_fixture_difficulty', players);
            const highestGS   = methods.getHighestStat('goals_scored', players);
            const highestA    = methods.getHighestStat('assists', players);
            const highestCS   = methods.getHighestStat('clean_sheets', players);
            const highestTI   = methods.getHighestStat('transfers_in_event', players);
            const lowestTO    = methods.getLowestStat('transfers_out_event', players);
            const highestF    = methods.getHighestStat('form', players);
            const highestICTI = methods.getHighestStat('ict_index', players);

            let ratios = {
                PPG: {
                    value: player.points_per_game / highestPPG,
                    weight: 1
                },
                VS: {
                    value: player.value_season / highestVS,
                    weight: 1
                },
                TTSP: {
                    value: player.top_teams_selected_by_percent / highestTTSP,
                    weight: 1
                },
                TTCP: {
                    value: player.top_teams_captained_by_percent / highestTTCP,
                    weight: 1
                },
                TP: {
                    value: player.total_points / highestTP,
                    weight: 1
                },
                FD: {
                    value: lowestFD / player.fixture_difficulty,
                    weight: 2
                },
                OTFD: {
                    value: player.opposing_team_fixture_difficulty / highestOTFD,
                    weight: 1
                },
                GS: {
                    value: player.goals_scored / highestGS,
                    weight: 1
                },
                A: {
                    value: player.assists / highestA,
                    weight: 1
                },
                CS: {
                    value: player.clean_sheets / highestCS,
                    weight: 1
                },
                TI: {
                    value: player.transfers_in_event / highestTI,
                    weight: 1
                },
                TO: {
                    value: lowestTO / player.transfers_out_event,
                    weight: 1
                },
                F: {
                    value: player.form / highestF,
                    weight: 1
                },
                ICTI: {
                    value: player.ict_index / highestICTI,
                    weight: 1
                },
            };

            if (player.position == 'GKP' || player.position == 'DEF') {
                ratios.CS.weight = 2;
            }

            if (player.position == 'FWD') {
                ratios.CS.weight = 0;
            }

            return Object.values(ratios).reduce((total, ratio) => total + (ratio.value * ratio.weight), 0);
        },

        getHighestStat: (stat, players) => {
            return [...players].sort((playerA, playerB) => playerB[stat] - playerA[stat])[0][stat];
        },

        getLowestStat: (stat, players) => {
            return [...players].sort((playerA, playerB) => playerA[stat] - playerB[stat])[0][stat];
        },

        getTopPickedTeam: players => {
            const gkpNum = 2;
            const defNum = 5;
            const midNum = 5;
            const fwdNum = 3;

            const playerSortFunction  = (playerA, playerB) => playerB.top_teams_selected_by_percent - playerA.top_teams_selected_by_percent;
            const captainSortFunction = (playerA, playerB) => playerB.top_teams_captained_by_percent - playerA.top_teams_captained_by_percent;

            let allGkpPlayers = players.filter(player => player.position === 'GKP').sort(playerSortFunction);
            let allDefPlayers = players.filter(player => player.position === 'DEF').sort(playerSortFunction);
            let allMidPlayers = players.filter(player => player.position === 'MID').sort(playerSortFunction);
            let allFwdPlayers = players.filter(player => player.position === 'FWD').sort(playerSortFunction);

            let mostCaptained = players.sort(captainSortFunction)[0];

            let pickedGkpPlayers = [];
            let pickedDefPlayers = [];
            let pickedMidPlayers = [];
            let pickedFwdPlayers = [];

            for (let i = 0; i < gkpNum; i++) {
                let player = allGkpPlayers[i];
                pickedGkpPlayers.push(`${player.web_name}${mostCaptained === player ? ' (C)': ''}`);
            }

            for (let i = 0; i < defNum; i++) {
                let player = allDefPlayers[i];
                pickedDefPlayers.push(`${player.web_name}${mostCaptained === player ? ' (C)': ''}`);
            }

            for (let i = 0; i < midNum; i++) {
                let player = allMidPlayers[i];
                pickedMidPlayers.push(`${player.web_name}${mostCaptained === player ? ' (C)': ''}`);
            }

            for (let i = 0; i < fwdNum; i++) {
                let player = allFwdPlayers[i];
                pickedFwdPlayers.push(`${player.web_name}${mostCaptained === player ? ' (C)': ''}`);
            }

            return {
                gkp: pickedGkpPlayers,
                def: pickedDefPlayers,
                mid: pickedMidPlayers,
                fwd: pickedFwdPlayers,
            }
        },

        pickTeam: (players) => {
            const oneTeamMax = 3;
            let teamPicks    = {};

            const positionMax = {
                GKP: 1,
                DEF: 5,
                MID: 5,
                FWD: 3,
            };
            const totalAvailablePicks = Object.values(positionMax).reduce((a, b) => a + b);

            let budget = 960;

            const allPlayers = {
                GKP: players.filter(player => player.position === 'GKP'),
                DEF: players.filter(player => player.position === 'DEF'),
                MID: players.filter(player => player.position === 'MID'),
                FWD: players.filter(player => player.position === 'FWD'),
            }

            let pickedPlayers = {
                GKP: [],
                DEF: [],
                MID: [],
                FWD: [],
            };

            let totalMadePicks = 0;

            const pick = (position) => {
                if (pickedPlayers[position].length === positionMax[position]) {
                    return false;
                }

                let playerBudget = totalMadePicks < 7 ? budget : budget / (totalAvailablePicks - totalMadePicks);

                let player = allPlayers[position]
                    .filter(player => player.now_cost <= playerBudget && player.news == '')
                    .sort((playerA, playerB) => {
                        return playerB.desirability - playerA.desirability;
                    })[0] || {};

                if (pickedPlayers[position].includes(player) || teamPicks[player.team_code] == oneTeamMax) {
                    let playerIndex = allPlayers[position].indexOf(player);
                    allPlayers[position].splice(playerIndex, 1);
                    return pick(position);
                }

                pickedPlayers[position].push(player);
                teamPicks[player.team_code] = (teamPicks[player.team_code] || 0) + 1;
                budget -= player.now_cost;

                totalMadePicks++;
            }

            while (totalMadePicks < totalAvailablePicks) {
                pick('FWD');
                pick('MID');
                pick('DEF');
                pick('GKP');
            }

            return {
                team: {
                    GKP: pickedPlayers.GKP.map(player => `${player.web_name} - ${player.desirability}`),
                    DEF: pickedPlayers.DEF.map(player => `${player.web_name} - ${player.desirability}`),
                    MID: pickedPlayers.MID.map(player => `${player.web_name} - ${player.desirability}`),
                    FWD: pickedPlayers.FWD.map(player => `${player.web_name} - ${player.desirability}`)
                },
                remaining_budget: budget / 10
            };
        },

        getSuggestedTransfers: (myTeam, players, prioritisePlayersWithNews = true) => {
            if (myTeam.transfers.limit <= myTeam.transfers.made) {
                return;
            }

            let potentialTransfers = myTeam.picks.map(pick => {
                let currentPlayer = players.find(player => player.id == pick.element);
                let money         = myTeam.transfers.bank + pick.selling_price;
                let bestOption    = players.filter(player => {
                    let playerInTeam = !!myTeam.picks.find(pick => pick.element == player.id);
                    return player.position === currentPlayer.position && player.now_cost <= money && player.news == '' && !playerInTeam;
                }).sort((playerA, playerB) => {
                    return playerB.desirability - playerA.desirability;
                })[0];
                return {
                    position: pick.position,
                    potentialImprovement: bestOption.desirability - currentPlayer.desirability,
                    playerOut: currentPlayer,
                    playerIn: bestOption,
                };
            });

            if (prioritisePlayersWithNews) {
                let transfersWithNews = potentialTransfers.filter(transfer => {
                    return transfer.playerOut.news != '';
                });

                if (transfersWithNews.length > 0) {
                    return transfersWithNews.slice(0, myTeam.transfers.limit - myTeam.transfers.made);
                }
            }

            return potentialTransfers.filter(transfer => {
                return transfer.position != 12 && transfer.potentialImprovement > 0;
            }).sort((transferA, transferB) => {
                return transferB.potentialImprovement - transferA.potentialImprovement;
            }).slice(0, myTeam.transfers.limit - myTeam.transfers.made);
        },

        login: async (email, password) => {
            console.debug(`Getting cookie data for ${email} from cache`);
            let cookieCache = cache(`${email}${password}`);
            let cookieData  = cookieCache.get();

            if (cookieData === null) {
                console.debug('Cache expired, fetching cookie data from FPL API');

                const params = new URLSearchParams();
                params.append('login', email);
                params.append('password', password);
                params.append('app', 'plfpl-web');
                params.append('redirect_uri', 'https://fantasy.premierleague.com/a/login');

                cookieData = await axiosInstance.post(loginEndpoint, params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    withCredentials: true,
                    maxRedirects: 0,
                    validateStatus: status => {
                        return status <= 302; // Reject only if the status code is greater than 302
                    },
                }).then(({ headers }) => headers['set-cookie'].join('; '));

                console.debug(`Saving cookie data for ${email} to cache`);
                cookieCache.set(cookieData, 604800000);
                cookieCache.save();
            }

            return cookieData;
        },

        getProfile: async (email, cookies) => {
            console.debug(`Getting profile for ${email} from cache`);
            let profileCache = cache(`${email}profile`);
            let profileData  = profileCache.get();

            if (profileData === null) {
                console.debug(`Cache expired, fetching profile for ${email} from FPL API`);
                profileData = await axiosInstance.get(profileEndpoint, {
                    headers: {
                        'Cookie': cookies
                    }
                }).then(response => response.data);

                console.debug(`Saving profile for ${email} to cache`);
                profileCache.set(profileData);
                profileCache.save();
            }

            return profileData;
        },

        getMyTeam: async (teamID, cookies) => {
            console.debug(`Getting my team for ${teamID} from cache`);
            let teamCache = cache(`${teamID}myteam`);
            let teamData  = teamCache.get();

            if (teamData === null) {
                console.debug(`Cache expired, fetching my team for ${teamID} from FPL API`);
                teamData = await axiosInstance.get(myTeamEndpoint(teamID), {
                    headers: {
                        'Cookie': cookies
                    }
                }).then(response => response.data);

                console.debug(`Saving my team for ${teamID} to cache`);
                teamCache.set(teamData);
                teamCache.save();
            }

            return teamData;
        },

        enrichMyTeam: (myTeam, players) => {
            let myTeamEnriched = {
                chips: myTeam.chips,
                transfers: myTeam.transfers,
            }

            myTeamEnriched.picks = myTeam.picks.map(pick => {
                return {...pick, ...players.find(player => player.id == pick.element)};
            });

            return myTeamEnriched;
        },
    }

    return methods;
}