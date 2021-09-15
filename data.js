const apiBase           = 'https://fantasy.premierleague.com/api/';
const bootstrapEndpoint = 'bootstrap-static/';
const topTeamsEndpoint  = 'leagues-classic/314/standings/?page_standings=';
const teamPicksEndpoint = (entry, gameWeek) => `/entry/${entry}/event/${gameWeek}/picks/`;
const fixturesEndpoint  = 'fixtures/?event=';

module.exports = (axios, randomUseragent, cache) => {
    let axiosInstance = axios.create({
        baseURL: apiBase,
        headers: {
          'User-Agent': randomUseragent.getRandom()
        }
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
                teamCache.set(teamData);
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

            return players.map(player => {
                let enrichedPlayer = {
                    'id': player.id,
                    'first_name': player.first_name,
                    'second_name': player.second_name,
                    'web_name': player.web_name,
                    'now_cost': player.now_cost,
                    'points_per_game': player.points_per_game,
                    'team_code': player.team_code,
                    'total_points': player.total_points,
                    'transfers_in_event': player.transfers_in_event,
                    'transfers_out_event': player.transfers_out_event,
                    'value_season': player.value_season,
                    'minutes': player.minutes,
                    'goals_scored': player.goals_scored,
                    'assists': player.assists,
                    'clean_sheets': player.clean_sheets,
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
        }
    }

    return methods;
}