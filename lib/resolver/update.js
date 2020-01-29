const { toJson } = require('../utils');

module.exports = modelData => async function resolve(ctx, data, graphQlCtx, root) {
  ctx = ctx || {};
  const { input } = data;
  const { modelClass } = modelData;
  const { idColumn } = modelClass;
  const { [idColumn]: id, ...inputData } = input;

  await modelClass
    .query(ctx.knex)
    .findOne({ [idColumn]: id })
    .update({
      ...inputData,
    });

  return this.queryFromGraphQlRoot(ctx, root, modelData, { argFiltering: false })
    .findOne({ [idColumn]: id })
    .then(toJson);
};
