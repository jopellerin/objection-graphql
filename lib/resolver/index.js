
const createResolver = require('./create');
const deleteResolver = require('./delete');
const listResolver = require('./list');
const modelResolver = require('./model');
const updateResolver = require('./update');
const countResolver = require('./count');

module.exports = {
  create: createResolver,
  list: listResolver,
  model: modelResolver,
  update: updateResolver,
  delete: deleteResolver,
  count: countResolver,
};
