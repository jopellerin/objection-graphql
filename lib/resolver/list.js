const { toJson } = require('../utils');

module.exports = modelData => function resolve(ctx, input, graphQlCtx, root) {
  ctx = ctx || {};
  return this.queryFromGraphQlRoot(ctx, root, modelData)
    .then(toJson);
};

