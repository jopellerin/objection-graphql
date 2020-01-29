
const _ = require('lodash');

function isExcluded(opt, prop) {
  return (opt.include && opt.include.indexOf(prop) === -1)
    || (opt.exclude && opt.exclude.indexOf(prop) !== -1);
}

function typeNameForModel(modelClass) {
  return _.upperFirst(_.camelCase(modelClass.tableName));
}

function isNullSchema(schema) {
  return isNullType(schema.type) || (_.isArray(schema.type) && _.every(schema.type, isNullType));
}

function isNullType(type) {
  return type === 'null' || type === null;
}

function hasCustomType(type, ctx) {
  return !!ctx.customTypes[type];
}

function fieldNameForModel(modelClass) {
  return _.camelCase(typeNameForModel(modelClass));
}

function toJson(result) {
  if (_.isArray(result)) {
    for (let i = 0, l = result.length; i < l; i += 1) {
      result[i] = result[i].$toJson();
    }
  } else {
    result = result && result.$toJson();
  }

  return result;
}

function getIdColumnName(modelData) {
  const { idColumn } = modelData.modelClass;
  return idColumn;
}

module.exports = {
  fieldNameForModel,
  getIdColumnName,
  hasCustomType,
  isExcluded,
  isNullSchema,
  isNullType,
  toJson,
  typeNameForModel,
};
