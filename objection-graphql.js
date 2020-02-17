const SchemaBuilder = require('./lib/builder');
const { toJson } = require('./lib/utils');

module.exports = {
  builder(options) {
    return new SchemaBuilder(options);
  },
  toJson,
};
