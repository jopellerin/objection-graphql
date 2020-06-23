const { toJson } = require('../utils');

module.exports = modelData => function resolve(ctx, input, graphQlCtx, root) {
  ctx = ctx || {};
  const { modelClass } = modelData;
  const { idColumn } = modelClass;
  const { [idColumn]: id } = input;

  if (!id) {
    throw new Error(`${idColumn} was not provided`);
  }

  return this.queryFromGraphQlRoot(ctx, root, modelData)
    .findOne({ [idColumn]: id })
    .then(toJson);
};

