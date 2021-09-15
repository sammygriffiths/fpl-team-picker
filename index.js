const axios           = require('axios');
const randomUseragent = require('random-useragent');
const cache           = require('./cache');

const run = async (axios, randomUseragent, cache) => {
    console.debug('Getting data from cache');
    let data = cache.get();
    
    if (data === null) {
        console.debug('Cache expired, fetching data from FPL API');

        let requestConfig = {
            headers: {
                'User-Agent': randomUseragent.getRandom()
            }
        };

        data = await axios.get('https://fantasy.premierleague.com/api/bootstrap-static/', requestConfig)
            .then(response => response.data);

        console.debug('Saving data to cache');
        cache.set(data);
        cache.save();
    }
    
    console.log(data);
};

run(axios, randomUseragent, cache);