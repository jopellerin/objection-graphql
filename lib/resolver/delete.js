
module.exports = modelData => async function resolve(ctx, input, graphQlCtx, root) {
  ctx = ctx || {};
  const { modelClass } = modelData;
  const { idColumn } = modelClass;
  const { [idColumn]: id } = input;
  const builder = modelClass.query(ctx.knex);

  builder.findOne({ [idColumn]: id });

  if (ctx.onQuery) {
    ctx.onQuery(builder, ctx);
  }

  const model = await builder;

  await builder.delete();

  return model;
};
