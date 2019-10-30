

const SchemaBuilder = require('./lib/SchemaBuilder');

module.exports = {
  builder(options) {
    return new SchemaBuilder(options);
  },
};
