const _ = require('lodash');

/* @var this  */

class BaseResolver {
  GRAPHQL_META_FIELDS = [
    '__typename',
  ];

  // GraphQL AST node types.
  KIND_FRAGMENT_SPREAD = 'FragmentSpread';
  KIND_VARIABLE = 'Variable';
  KIND_OBJECT_VALUE = 'ObjectValue';

  constructor(options) {
    const {
      builderOptions = {},
      allModels = {},
      enableSelectFiltering = true,
      generateId = null,
    } = options;
    this.allModels = allModels;
    this.builderOptions = builderOptions;
    this.enableSelectFiltering = enableSelectFiltering;
    this._generateIdDefaultCallback = generateId;
  }

  generateId = (modelData) => {
    const { generateId } = modelData;
    if (_.isFunction(generateId)) {
      return generateId();
    }

    if (_.isFunction(this._generateIdDefaultCallback)) {
      return this._generateIdDefaultCallback();
    }

    return null;
  };

  queryFromGraphQlRoot = (
    ctx = {},
    root,
    modelData,
    options
  ) => {
    options = _.extend({}, {
      argFiltering: true,
      buildEager: true,
      selectFiltering: true,
    }, options);
    const { argFiltering, buildEager, selectFiltering } = options;
    const { modelClass } = modelData;
    const ast = (root.fieldASTs || root.fieldNodes)[0];
    const builder = modelClass.query(ctx.knex);

    if (this.builderOptions && this.builderOptions.skipUndefined) {
      builder.skipUndefined();
    }

    if (ctx.onQuery) {
      ctx.onQuery(builder, ctx);
    }

    if (argFiltering) {
      const argFilter = this.filterForArgs(ast, modelData, root.variableValues);
      builder.modify(argFilter);
    }

    if (selectFiltering) {
      const selectFilter = this.filterForSelects(ast, modelClass, root);
      builder.modify(selectFilter);
    }

    if (buildEager) {
      const eager = this.buildEager(ast, modelClass, root);
      if (eager.expression) {
        builder.eager(eager.expression, eager.filters);
      }
    }

    return builder;
  };

  buildEager = (astNode, modelClass, astRoot, filterIndex = 0) => {
    const eagerExpr = this.buildEagerSegment(astNode, modelClass, astRoot, filterIndex);
    if (eagerExpr.expression.length) {
      eagerExpr.expression = `[${eagerExpr.expression}]`;
    }
    return eagerExpr;
  };

  buildEagerSegment = (astNode, modelClass, astRoot, filterIndex = 0) => {
    const filters = {};
    const relations = modelClass.getRelations();
    let expression = '';

    for (let i = 0, l = astNode.selectionSet.selections.length; i < l; i += 1) {
      const selectionNode = astNode.selectionSet.selections[i];
      const relation = relations[selectionNode.name.value];

      if (relation) {
        expression = this.buildEagerRelationSegment(selectionNode, relation, expression, filters, astRoot, filterIndex);
      } else if (selectionNode.kind === this.KIND_FRAGMENT_SPREAD) {
        expression = this.buildEagerFragmentSegment(selectionNode, modelClass, expression, filters, astRoot, filterIndex);
      }
      filterIndex += 1;
    }

    return {
      expression,
      filters,
    };
  };

  buildEagerRelationSegment = (selectionNode, relation, expression, filters, astRoot, filterIndex = 0) => {
    let relExpr = selectionNode.name.value;

    const selectFilter = this.filterForSelects(selectionNode, relation.relatedModelClass, astRoot);
    const filterNames = [];

    if (selectFilter) {
      const filterName = `s${filterIndex}`;

      filterNames.push(filterName);
      filters[filterName] = selectFilter;
    }

    if (selectionNode.arguments.length) {
      const relatedModelData = this.allModels[relation.relatedModelClass.tableName];
      const argFilter = this.filterForArgs(selectionNode, relatedModelData, astRoot.variableValues);

      if (argFilter) {
        const filterName = `f${filterIndex}`;

        filterNames.push(filterName);
        filters[filterName] = argFilter;
      }
    }

    if (filterNames.length) {
      relExpr += `(${filterNames.join(', ')})`;
    }

    const subExpr = this.buildEager(selectionNode, relation.relatedModelClass, astRoot, filterIndex);

    if (subExpr.expression.length) {
      relExpr += `.${subExpr.expression}`;
      Object.assign(filters, subExpr.filters);
    }

    if (expression.length) {
      expression += ', ';
    }

    return expression + relExpr;
  };

  buildEagerFragmentSegment = (selectionNode, modelClass, expression, filters, astRoot) => {
    const fragmentSelection = astRoot.fragments[selectionNode.name.value];
    const fragmentExpr = this.buildEagerSegment(fragmentSelection, modelClass, astRoot);
    let fragmentExprString = '';

    if (fragmentExpr.expression.length) {
      fragmentExprString += fragmentExpr.expression;
      Object.assign(filters, fragmentExpr.filters);
    }

    if (expression.length) {
      expression += ', ';
    }

    return expression + fragmentExprString;
  };

  filterForArgs = (astNode, modelData, variables) => {
    const args = astNode.arguments;

    if (args.length === 0) {
      return null;
    }

    const argObjects = new Array(args.length);

    for (let i = 0, l = args.length; i < l; i += 1) {
      const arg = args[i];
      const value = this.argValue(arg.value, variables);

      argObjects[i] = {
        name: arg.name.value,
        value,
      };
    }

    return (builder) => {
      for (let i = 0, l = argObjects.length; i < l; i += 1) {
        const arg = argObjects[i];
        if (!(typeof arg.value === 'undefined' && builder.internalOptions().skipUndefined)) {
          modelData.args[arg.name].query(builder, arg.value);
        }
      }
    };
  };

  filterForSelects = (astNode, modelClass, astRoot) => {
    if (!this.enableSelectFiltering) {
      return null;
    }

    const relations = modelClass.getRelations();
    const { virtualAttributes } = modelClass;
    const selects = this.collectSelects(astNode, relations, virtualAttributes, astRoot.fragments, []);

    if (selects.length === 0) {
      return null;
    }

    return (builder) => {
      const { jsonSchema } = modelClass;
      builder.select(selects.map((it) => {
        const col = modelClass.propertyNameToColumnName(it);
        if (jsonSchema.properties[it]) {
          return `${builder.tableRefFor(modelClass)}.${col}`;
        }
        return col;
      }));
    };
  };

  collectSelects = (astNode, relations, virtuals, fragments, selects) => {
    for (let i = 0, l = astNode.selectionSet.selections.length; i < l; i += 1) {
      const selectionNode = astNode.selectionSet.selections[i];
      if (selectionNode.kind === this.KIND_FRAGMENT_SPREAD) {
        this.collectSelects(fragments[selectionNode.name.value], relations, virtuals, fragments, selects);
      } else {
        const relation = relations[selectionNode.name.value];
        const isMetaField = this.GRAPHQL_META_FIELDS.indexOf(selectionNode.name.value) !== -1;

        if (!relation && !isMetaField && !_.includes(virtuals, selectionNode.name.value)) {
          selects.push(selectionNode.name.value);
        }
      }
    }

    return selects;
  };

  argValue = (value, variables) => {
    if (value.kind === this.KIND_VARIABLE) {
      return variables[value.name.value];
    } else if ('value' in value) {
      return value.value;
    } else if (Array.isArray(value.values)) {
      return value.values.map(curValue => argValue(curValue, variables));
    } else if (value.kind === this.KIND_OBJECT_VALUE) {
      return value.fields.reduce((args, field) => ({
        ...args,
        [field.name.value]: this.argValue(field.value, variables),
      }), {});
    }
    throw new Error(`objection-graphql cannot handle argument value ${JSON.stringify(value)}`);
  }
}

module.exports = BaseResolver;
