module.exports = (id) => {
    const flatCache = require('flat-cache').load(id);

    const cache = {
        set: (data, expire = 3600000) => {
            flatCache.setKey('timestamp', new Date().getTime());
            flatCache.setKey('expire', expire);
            flatCache.setKey('data', data);
        },
        setKey: (key, value) => {
            let data = flatCache.getKey('data');
            data[key] = value;
            cache.set(data);
        },
        get: () => !cache.hasExpired() ? flatCache.getKey('data') : null,
        getKey: key => {
            if (cache.hasExpired()) {
                return null;
            }
    
            let data = flatCache.getKey('data');
            return data[key];
        },
        save: () => flatCache.save(true),
        clear: () => {
            flatCache.removeKey('timestamp');
            flatCache.removeKey('expire');
            flatCache.removeKey('data');
        },
        hasExpired: () => {
            let expire = flatCache.getKey('expire');
    
            if (expire === false) {
                return false;
            }
    
            let timestamp = flatCache.getKey('timestamp');
    
            if (typeof expire !== 'number' || typeof timestamp !== 'number') {
                return true;
            }
    
            return new Date().getTime() >= flatCache.getKey('timestamp') + expire;
        }
    };
    return cache;
};