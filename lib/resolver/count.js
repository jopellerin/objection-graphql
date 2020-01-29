const { toJson } = require('../utils');

module.exports = modelData => function resolve(ctx, input, graphQlCtx, root) {
  ctx = ctx || {};
  const { modelClass } = modelData;
  const builder = this.queryFromGraphQlRoot(ctx, root, modelData, {
    buildEager: false,
    selectFiltering: false,
  });

  builder
    .count(`${modelClass.idColumn} as count`)
    .first();

  return builder.then((res) => {
    const { count } = toJson(res);
    return count;
  });
};
