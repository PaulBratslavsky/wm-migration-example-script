export const ImageCacheManager = (function() {
  let instance;
  
  function createInstance() {
    return {
      _store: new Map(),
      
      set(key, value) {
        this._store.set(key, value);
        console.log('+ Cache set:', key, '->', value.filename);
      },
      
      get(key) {
        return this._store.get(key);
      },
      
      has(key) {
        return this._store.has(key);
      },
      
      getStats() {
        return {
          size: this._store.size,
          entries: [...this._store.entries()]
            .map(([key, value]) => `\n  ${value.filename}`)
            .join('')
        };
      }
    };
  }
  
  return {
    getInstance: function() {
      if (!instance) {
        instance = createInstance();
      }
      return instance;
    }
  };
})();
