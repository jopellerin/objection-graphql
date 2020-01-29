const _ = require('lodash');
const {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
} = require('graphql');
const objection = require('objection');
const { jsonSchemaToGraphQLFields } = require('./jsonSchema');
const utils = require('./utils');
const defaultArgFactories = require('./argFactories');
const defaultResolvers = require('./resolver');
const BaseResolver = require('./resolver/base');

// Default arguments that are excluded from the relation arguments.
const OMIT_FROM_RELATION_ARGS = [
  // We cannot use `range` in the relation arguments since the relations are fetched
  // for multiple objects at a time. Limiting the result set would limit the combined
  // result, and not the individual model's relation.
  'range',
];

class Builder {
  constructor(options = {}) {
    const {
      customTypes = {},
      generateId = null,
    } = options;
    this.customTypes = customTypes;
    this.generateId = generateId;
    this.models = {};
    this.typeCache = {};
    this.argFactories = [];
    this.enableSelectFiltering = true;
    this.defaultArgNameMap = {
      eq: 'Eq',
      gt: 'Gt',
      gte: 'Gte',
      lt: 'Lt',
      lte: 'Lte',
      like: 'Like',
      isNull: 'IsNull',
      likeNoCase: 'LikeNoCase',
      in: 'In',
      notIn: 'NotIn',
      orderBy: 'orderBy',
      orderByDesc: 'orderByDesc',
      range: 'range',
      limit: 'limit',
      offset: 'offset',
    };
    this.defaultModelOpt = {
      resolvers: {
        // can be boolean or resolver function
        // if false - operation will not be available
        // if null - operation available with default resolver
        // if resolver function - operation available with custom resolver
        create: null,
        list: null,
        model: null,
        update: null,
        delete: null,

        count: null,
      },

      // null or function that returns a new ID
      // is used by the default create resolver
      // useful when using uuids instead of auto increment
      // leave null for default storage behavior
      generateId: null,

      // type configuration
      fieldName: null,
      listFieldName: null,
      rowCountFieldName: null,

      // include/exclude model attributes
      include: null,
      exclude: null,
    };
  }

  model(modelClass, opt) {
    opt = _.merge({}, this.defaultModelOpt, opt);

    if (!modelClass.jsonSchema) {
      const modelName = modelClass.constructor.name;
      throw new Error(`model "${modelName}" must have a jsonSchema`);
    }

    this.models[modelClass.tableName] = {
      modelClass,
      fields: null,
      relationExtras: {},
      args: null,
      opt,
    };
    return this;
  }

  allModels(models, opt) {
    models.forEach(model => this.model(model, opt));
    return this;
  }

  extendWithMutations(mutations) {
    if (!(mutations instanceof Object || mutations instanceof Function)) {
      throw new TypeError('mutations should be a function or an object of type GraphQLObjectType');
    }

    this.mutations = mutations;
    return this;
  }

  extendWithTypes(types) {
    if (!(types instanceof Object || types instanceof Function)) {
      throw new TypeError(`types should be a function or an object of type GraphQLObjectType`);
    }

    this.types = types;
    return this;
  }

  argFactory(argFactory) {
    this.argFactories.push(argFactory);
    return this;
  }

  selectFiltering(enable) {
    this.enableSelectFiltering = !!enable;
    return this;
  }

  extendWithMiddleware(middleware) {
    if (!(middleware instanceof Function)) {
      throw new TypeError('middleware should be a function');
    }

    this.middleware = middleware;
    return this;
  }

  extendWithSubscriptions(subscriptions) {
    if (!(subscriptions instanceof GraphQLObjectType || subscriptions instanceof Function)) {
      throw new TypeError('subscriptions should be a function or an object of type GraphQLObjectType');
    }

    this.subscription = subscriptions;
    return this;
  }

  setBuilderOptions(options) {
    this.builderOptions = options;
    return this;
  }

  build() {
    this.baseResolver = new BaseResolver({
      builderOptions: this.builderOptions,
      allModels: this.models,
      enableSelectFiltering: this.enableSelectFiltering,
      generateId: this.generateId,
    });

    _.forOwn(this.models, (modelData) => {
      modelData.fields = this.getGraphQlFields(modelData);
      modelData.args = this._argsForModel(modelData);
    });

    const fields = this._buildGraphQlFields(this.models);
    const mutations = this._buildGraphQlMutations(this.models);

    let subscription;
    if (this.subscription) {
      if (this.subscription instanceof Function) {
        subscription = this.subscription(this);
      } else {
        subscription = this.subscription;
      }
    }

    const schemaSetup = {
      query: new GraphQLObjectType({
        name: 'Query',
        fields: () => fields,
      }),
      mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: () => mutations,
      }),
      subscription,
    };

    return new GraphQLSchema(schemaSetup);
  }

  getGraphQlFields(modelData) {
    return jsonSchemaToGraphQLFields(modelData.modelClass.jsonSchema, {
      include: modelData.opt.include,
      exclude: modelData.opt.exclude,
      typeNamePrefix: utils.typeNameForModel(modelData.modelClass),
      typeCache: this.typeCache,
      customTypes: this.customTypes,
    });
  }

  _argsForModel(modelData) {
    const factories = defaultArgFactories(this.defaultArgNameMap, { typeCache: this.typeCache }).concat(this.argFactories);
    const args = factories.reduce((args, factory) => Object.assign(args, factory(modelData.fields, modelData.modelClass)), {});
    const { idColumn } = modelData.modelClass;

    args[idColumn] = {
      type: new GraphQLNonNull(GraphQLString),
      query: (query, value) => (
        query.where({ [idColumn]: value })
      ),
    };

    return args;
  }

  _buildGraphQlFields(models) {
    const fields = {};

    _.forOwn(models, (modelData) => {
      const {
        resolvers: {
          list: useList,
          model: useModel,
          count: useCount,
        }
      } = modelData.opt;
      const defaultFieldName = utils.fieldNameForModel(modelData.modelClass);
      const singleFieldName = modelData.opt.fieldName || defaultFieldName;

      if (useModel !== false) {
        fields[singleFieldName] = this._rootSingleField(modelData);
      }

      if (useList !== false) {
        const listFieldName = modelData.opt.listFieldName || `${defaultFieldName}s`;
        fields[listFieldName] = this._rootListField(modelData);
      }

      if (useCount !== false) {
        const rowCountFieldName = modelData.opt.rowCountFieldName || `${defaultFieldName}Count`;
        fields[rowCountFieldName] = this._rootCountField(modelData);
      }
    });
    return this._extendWithExtraTypes(fields);
  }

  _extendWithExtraTypes(types) {
    if (this.types) {
      let extraTypes;
      if (this.types instanceof Function) {
        extraTypes = this.types(this);
      } else {
        extraTypes = this.types;
      }

      Object.keys(extraTypes).forEach((typeName) => {
        if (types[typeName]) {
          throw new Error(`GraphQL type with type name "${typeName}" already exists`);
        }

        const { resolver, ...type } = extraTypes[typeName];
        const { modelData, resolve } = resolver;
        const resolverFunction = resolve(modelData);

        types[typeName] = {
          ...type,
          resolve: this.middlewareResolver(resolverFunction.bind(this.baseResolver), modelData),
        };
      });
    }

    return types;
  }

  _buildGraphQlMutations(models) {
    const mutations = {};

    _.forOwn(models, (modelData) => {
      const {
        resolvers: {
          create: useCreate,
          update: useUpdate,
          delete: useDelete,
        },
      } = modelData.opt;

      const defaultFieldName = utils.fieldNameForModel(modelData.modelClass);
      const singleFieldName = modelData.opt.fieldName || defaultFieldName;
      if (useCreate !== false) {
        const createMutationName = `create${_.upperFirst(singleFieldName)}`;
        mutations[createMutationName] = this._mutationCreate(createMutationName, modelData);
      }
      if (useUpdate !== false) {
        const updateMutationName = `update${_.upperFirst(singleFieldName)}`;
        mutations[updateMutationName] = this._mutationUpdate(updateMutationName, modelData, 'update');
      }

      if (useDelete !== false) {
        const deleteMutationName = `delete${_.upperFirst(singleFieldName)}`;
        mutations[deleteMutationName] = this._mutationDelete(deleteMutationName, modelData, 'delete');
      }
    });

    return this._extendWithExtraMutations(mutations);
  }

  _extendWithExtraMutations(mutations) {
    if (this.mutations) {
      let extraMutations;
      if (this.mutations instanceof Function) {
        extraMutations = this.mutations(this);
      } else {
        extraMutations = this.mutations;
      }

      Object.keys(extraMutations).forEach((typeName) => {
        if (mutations[typeName]) {
          throw new Error(`Mutation with type name "${typeName}" already exists`);
        }

        const { resolver, ...mutation } = extraMutations[typeName];
        const { modelData, resolve } = resolver;
        const resolverFunction = resolve(modelData);

        mutations[typeName] = {
          ...mutation,
          resolve: this.middlewareResolver(resolverFunction.bind(this.baseResolver), modelData),
        };
      });
    }

    return mutations;
  }

  middlewareResolver(resolver, modelData) {
    if (this.middleware) {
      return this.middleware(resolver, modelData);
    }
    return resolver;
  }

  _resolverForModel(modelData, resolverName) {
    let { resolvers: { [resolverName]: resolver } } = modelData.opt;
    if (_.isNull(resolver)) {
      resolver = this._getDefaultResolver(resolverName);
    }

    if (!_.isFunction(resolver)) {
      throw new Error('Resolver must be either null, false, or a function');
    }

    const resolverFunction = resolver(modelData);
    return resolverFunction.bind(this.baseResolver);
  }

  _getDefaultResolver(resolverName) {
    const resolver = _.get(defaultResolvers, resolverName, null);
    if (_.isNull(resolver)) {
      throw new Error(`Default resolver for ${resolverName} does not exist.`);
    }

    return resolver;
  }

  _rootSingleField(modelData) {
    const { idColumn } = modelData.modelClass;
    const resolver = this._resolverForModel(modelData, 'model');
    return {
      type: this._typeForModel(modelData),
      args: {
        [idColumn]: {
          type: GraphQLNonNull(GraphQLString),

        },
      },
      resolve: this.middlewareResolver(resolver, modelData),
    };
  }

  _rootListField(modelData) {
    const idColumn = utils.getIdColumnName(modelData);
    const resolver = this._resolverForModel(modelData, 'list');
    return {
      type: new GraphQLList(this._typeForModel(modelData)),
      args: _.pickBy(modelData.args, (arg, argName) => argName !== idColumn),
      resolve: this.middlewareResolver(resolver, modelData),
    };
  }

  _rootCountField(modelData) {
    const resolver = this._resolverForModel(modelData, 'count');
    return {
      type: GraphQLInt,
      args: {
        filter: modelData.args.filter,
      },
      resolve: this.middlewareResolver(resolver, modelData),
    };
  }

  _mutationCreate(name, modelData) {
    const { idColumn } = modelData.modelClass;
    const inputName = _.upperFirst(`${name}Input`);
    const resolver = this._resolverForModel(modelData, 'create');
    const inputType = this._inputType(inputName, modelData, {
      exclude: [idColumn],
    });

    const args = {
      input: {
        type: new GraphQLNonNull(inputType),
      }
    };
    return this._mutation(modelData, args, resolver);
  }

  _mutationUpdate(name, modelData) {
    const resolver = this._resolverForModel(modelData, 'update');
    const inputName = _.upperFirst(`${name}Input`);
    const inputType = this._inputType(inputName, modelData, 'update');
    const args = {
      input: { type: new GraphQLNonNull(inputType) },
    };
    return this._mutation(modelData, args, resolver);
  }

  _mutationDelete(name, modelData) {
    const { idColumn } = modelData.modelClass;
    const resolver = this._resolverForModel(modelData, 'delete');
    const args = {
      [idColumn]: {
        type: new GraphQLNonNull(GraphQLString),
      },
    };
    return this._mutation(modelData, args, resolver);
  }

  _mutation(modelData, args, resolver) {
    return {
      type: this._typeForModel(modelData),
      args,
      resolve: this.middlewareResolver(resolver, modelData),
    };
  }

  _inputType(name, modelData, options = {}) {
    const exclude = options.exclude || [];
    const include = options.include || [];

    const fields = Object.keys(modelData.fields).reduce((fields, field) => {
      if ((exclude.length > 0 && exclude.indexOf(field) !== -1) ||
        (include.length > 0 && include.indexOf(field) === -1)) {
        return fields;
      }

      return {
        ...fields,
        [field]: modelData.fields[field],
      };
    }, {});

    return new GraphQLInputObjectType({
      name,
      fields,
    });
  }

  _typeForModel(modelData, relation = null) {
    let typeName = utils.typeNameForModel(modelData.modelClass);

    let extras = {};
    if (relation) {
      const relationExtras = this._getRelationExtras(relation);
      if (!_.isEmpty(relationExtras)) {
        const typeNamePrefix = utils.typeNameForModel(relation.ownerModelClass);
        typeName = `${typeNamePrefix}${typeName}`;
        extras = relationExtras;
      }
    }

    if (!this.typeCache[typeName]) {
      this.typeCache[typeName] = new GraphQLObjectType({
        name: typeName,
        fields: () => Object.assign({},
          this._attrFields(modelData),
          this._relationFields(modelData),
          extras,
        ),
      });
    }

    return this.typeCache[typeName];
  }

  _getRelationExtras(relation) {
    const fields = _.map(relation.joinTableExtras, 'joinTableCol');
    if (!fields) {
      return {};
    }

    const extras = jsonSchemaToGraphQLFields({
      properties: fields.reduce((carry, field) => ({ ...carry, [field]: { type: 'string' } }), {})
    });

    return extras;
  }

  _attrFields(modelData) {
    return modelData.fields;
  }

  _relationFields(modelData) {
    const fields = {};

    _.forOwn(modelData.modelClass.getRelations(), (relation) => {
      const relationModel = this.models[relation.relatedModelClass.tableName];

      if (!relationModel) {
        // If the relation model has not been given for the builder using `model()` method
        // we don't handle the relations that have that class.
        return;
      }

      if (utils.isExcluded(relationModel.opt, relation.name)) {
        // If the property by the relation's name has been excluded, skip this relation.
        return;
      }

      fields[relation.name] = this._relationField(relationModel, relation);
    });

    return fields;
  }

  _relationField(modelData, relation) {
    const idColumn = utils.getIdColumnName(modelData);
    if (relation instanceof objection.HasOneRelation
      || relation instanceof objection.BelongsToOneRelation
      || relation instanceof objection.HasOneThroughRelation) {

      return {
        type: this._typeForModel(modelData, relation),
        args: _.omit(modelData.args, [...OMIT_FROM_RELATION_ARGS, idColumn]),
      };
    } else if (relation instanceof objection.HasManyRelation || relation instanceof objection.ManyToManyRelation) {
      return {
        type: new GraphQLList(this._typeForModel(modelData, relation)),
        args: _.omit(modelData.args, [...OMIT_FROM_RELATION_ARGS, idColumn]),
      };
    }
    throw new Error(`relation type "${relation.constructor.name}" is not supported`);
  }
}

module.exports = Builder;
