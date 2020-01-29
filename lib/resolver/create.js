const _ = require('lodash');
const { toJson } = require('../utils');

module.exports = modelData => async function resolve(ctx, { input }, graphQlCtx, root) {
  ctx = ctx || {};
  const { modelClass } = modelData;
  const { idColumn } = modelClass;
  const insertQuery = modelClass.query(ctx.knex);

  const id = this.generateId(modelData);
  const inputData = {
    ...input,
    [idColumn]: id,
  };

  await insertQuery
    .insert(inputData);

  return this.queryFromGraphQlRoot(ctx, root, modelData, { argFiltering: false })
    .findOne({ [idColumn]: id })
    .then(toJson);
};
