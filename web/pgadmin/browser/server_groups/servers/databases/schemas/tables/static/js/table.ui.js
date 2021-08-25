import gettext from 'sources/gettext';
import BaseUISchema from 'sources/SchemaView/base_schema.ui';
import SecLabelSchema from 'top/browser/server_groups/servers/static/js/sec_label.ui';
import _ from 'lodash';
import { isEmptyString } from 'sources/validators';
import PrimaryKeySchema from '../../constraints/index_constraint/static/js/primary_key.ui';
import { SCHEMA_STATE_ACTIONS } from '../../../../../../../../static/js/SchemaView';
import { PartitionKeysSchema, PartitionsSchema } from './partition.utils.ui';
import { pgAlertify } from '../../../../../../../../static/js/helpers/legacyConnector';
import CheckConstraintSchema from '../../constraints/check_constraint/static/js/check_constraint.ui';
import UniqueConstraintSchema from '../../constraints/index_constraint/static/js/unique_constraint.ui';
import { getNodeAjaxOptions, getNodeListByName } from '../../../../../../../static/js/node_ajax';
import { getNodeColumnSchema } from '../../columns/static/js/column.ui';
import { getNodeVacuumSettingsSchema } from '../../../../../static/js/vacuum.ui';
import { getNodeForeignKeySchema } from '../../constraints/foreign_key/static/js/foreign_key.ui';
import { getNodeExclusionConstraintSchema } from '../../constraints/exclusion_constraint/static/js/exclusion_constraint.ui';
import { getNodePrivilegeRoleSchema } from '../../../../../static/js/privilege.ui';

export function getNodeTableSchema(treeNodeInfo, itemNodeData, pgBrowser) {
  const spcname = ()=>getNodeListByName('tablespace', treeNodeInfo, itemNodeData, {}, (m)=>{
    return (m.label != 'pg_global');
  });

  let tableNode = pgBrowser.Nodes['table'];

  return new TableSchema(
    {
      relowner: ()=>getNodeListByName('role', treeNodeInfo, itemNodeData),
      schema: ()=>getNodeListByName('schema', treeNodeInfo, itemNodeData, {
        cacheLevel: 'database',
        cacheNode: 'database',
      }, (d)=>{
        // If schema name start with pg_* then we need to exclude them
        if(d && d.label.match(/^pg_/))
        {
          return false;
        }
        return true;
      }),
      spcname: spcname,
      coll_inherits: ()=>getNodeAjaxOptions('get_inherits', tableNode, treeNodeInfo, itemNodeData),
      typname: ()=>getNodeAjaxOptions('get_oftype', tableNode, treeNodeInfo, itemNodeData),
      like_relation: ()=>getNodeAjaxOptions('get_relations', tableNode, treeNodeInfo, itemNodeData),
    },
    treeNodeInfo,
    {
      columns: ()=>getNodeColumnSchema(treeNodeInfo, itemNodeData, pgBrowser),
      vacuum_settings: ()=>getNodeVacuumSettingsSchema(tableNode, treeNodeInfo, itemNodeData),
      constraints: ()=>new ConstraintsSchema(
        treeNodeInfo,
        ()=>getNodeForeignKeySchema(treeNodeInfo, itemNodeData, pgBrowser, true),
        ()=>getNodeExclusionConstraintSchema(treeNodeInfo, itemNodeData, pgBrowser, true),
        {spcname: spcname},
      ),
    },
    (privileges)=>getNodePrivilegeRoleSchema(tableNode, treeNodeInfo, itemNodeData, privileges),
    (params)=>{
      return getNodeAjaxOptions('get_columns', tableNode, treeNodeInfo, itemNodeData, {urlParams: params, useCache:false});
    },
    {
      relowner: pgBrowser.serverInfo[treeNodeInfo.server._id].user.name,
      schema: treeNodeInfo.schema._label,
    }
  );
}

export class ConstraintsSchema extends BaseUISchema {
  constructor(nodeInfo, getFkObj, getExConsObj, otherOptions) {
    super();
    this.primaryKeyObj = new PrimaryKeySchema({
      spcname: otherOptions.spcname,
    }, nodeInfo);
    this.fkObj = getFkObj();
    this.uniqueConsObj = new UniqueConstraintSchema({
      spcname: otherOptions.spcname,
    }, nodeInfo);
    this.exConsObj = getExConsObj();
  }

  changeColumnOptions(colOptions) {
    this.primaryKeyObj.changeColumnOptions(colOptions);
    this.fkObj.changeColumnOptions(colOptions);
    this.uniqueConsObj.changeColumnOptions(colOptions);
    this.exConsObj.changeColumnOptions(colOptions);
  }

  anyColumnAdded(state) {
    return _.some(_.map(state.columns, 'name'));
  }

  get baseFields() {
    let obj = this;
    return [{
      id: 'primary_key', label: '',
      schema: this.primaryKeyObj,
      editable: false, type: 'collection',
      group: gettext('Primary Key'), mode: ['edit', 'create'],
      canEdit: true, canDelete: true, deps:['is_partitioned', 'typname'],
      columns : ['name', 'columns'],
      canAdd: function(state) {
        if (state.is_partitioned && obj.top.getServerVersion() < 110000) {
          return false;
        }
        return true;
      },
      canAddRow: function(state) {
        return ((state.primary_key||[]).length < 1 && obj.anyColumnAdded(state));
      },
      depChange: (state)=>{
        if (state.is_partitioned && obj.top.getServerVersion() < 110000 || state.columns?.length <= 0) {
          return {primary_key: []};
        }
      }
    },{
      id: 'foreign_key', label: '',
      schema: this.fkObj,
      editable: false, type: 'collection',
      group: gettext('Foreign Key'), mode: ['edit', 'create'],
      canEdit: true, canDelete: true, deps:['is_partitioned', 'columns'],
      canAdd: function(state) {
        if (state.is_partitioned && obj.top.getServerVersion() < 110000) {
          return false;
        }
        return true;
      },
      columns : ['name', 'columns','references_table_name'],
      canAddRow: obj.anyColumnAdded,
      depChange: (state)=>{
        if (state.is_partitioned && obj.top.getServerVersion() < 110000 || state.columns?.length <= 0) {
          return {foreign_key: []};
        }
      }
    },{
      id: 'check_constraint', label: '',
      schema: new CheckConstraintSchema(),
      editable: false, type: 'collection',
      group: gettext('Check'), mode: ['edit', 'create'],
      canEdit: true, canDelete: true, deps:['is_partitioned'],
      canAdd: true,
      columns : ['name', 'consrc'],
    },{
      id: 'unique_constraint', label: '',
      schema: this.primaryKeyObj,
      editable: false, type: 'collection',
      group: gettext('Unique'), mode: ['edit', 'create'],
      canEdit: true, canDelete: true, deps:['is_partitioned', 'typname'],
      columns : ['name', 'columns'],
      canAdd: function(state) {
        if (state.is_partitioned && obj.top.getServerVersion() < 110000) {
          return false;
        }
        return true;
      },
      canAddRow: obj.anyColumnAdded,
      depChange: (state)=>{
        if (state.is_partitioned && obj.top.getServerVersion() < 110000 || state.columns?.length <= 0) {
          return {unique_constraint: []};
        }
      }
    },{
      id: 'exclude_constraint', label: '',
      schema: this.exConsObj,
      editable: false, type: 'collection',
      group: gettext('Exclude'), mode: ['edit', 'create'],
      canEdit: true, canDelete: true, deps:['is_partitioned'],
      columns : ['name', 'columns', 'constraint'],
      canAdd: function(state) {
        if (state.is_partitioned && obj.top.getServerVersion() < 110000) {
          return false;
        }
        return true;
      },
      canAddRow: obj.anyColumnAdded,
      depChange: (state)=>{
        if (state.is_partitioned && obj.top.getServerVersion() < 110000 || state.columns?.length <= 0) {
          return {exclude_constraint: []};
        }
      },
    }];
  }
}

export class LikeSchema extends BaseUISchema {
  constructor(likeRelationOpts) {
    super();
    this.likeRelationOpts = likeRelationOpts;
  }

  isLikeDisable(state) {
    if(!this.top.inSchemaWithModelCheck(state) && isEmptyString(state.typname)) {
      return false;
    }
    return true;
  }

  isRelationDisable(state) {
    if(isEmptyString(state.like_relation)) {
      return true;
    }
    return false;
  }

  resetVals(state) {
    if(this.isRelationDisable(state) && this.top.isNew()) {
      return {
        like_default_value: false,
        like_constraints: false,
        like_indexes: false,
        like_storage: false,
        like_comments: false,
      };
    }
  }

  get baseFields() {
    let obj = this;
    return [
      {
        id: 'like_relation', label: gettext('Relation'),
        type: 'select', mode: ['create'], deps: ['typname', 'like_relation'],
        options: obj.likeRelationOpts,
        disabled: obj.isLikeDisable,
        depChange: (state, source)=>{
          if(source == 'typname' && !isEmptyString(state.typname)) {
            state.like_relation = null;
            return {
              like_relation: null,
              ...obj.resetVals(state),
            };
          }
        }
      },{
        id: 'like_default_value', label: gettext('With default values?'),
        type: 'switch', mode: ['create'], deps: ['like_relation'],
        disabled: this.isRelationDisable, depChange: (...args)=>obj.resetVals(...args),
      },{
        id: 'like_constraints', label: gettext('With constraints?'),
        type: 'switch', mode: ['create'], deps: ['like_relation'],
        disabled: this.isRelationDisable, depChange: (...args)=>obj.resetVals(...args),
      },{
        id: 'like_indexes', label: gettext('With indexes?'),
        type: 'switch', mode: ['create'], deps: ['like_relation'],
        disabled: this.isRelationDisable, depChange: (...args)=>obj.resetVals(...args),
      },{
        id: 'like_storage', label: gettext('With storage?'),
        type: 'switch', mode: ['create'], deps: ['like_relation'],
        disabled: this.isRelationDisable, depChange: (...args)=>obj.resetVals(...args),
      },{
        id: 'like_comments', label: gettext('With comments?'),
        type: 'switch', mode: ['create'], deps: ['like_relation'],
        disabled: this.isRelationDisable, depChange: (...args)=>obj.resetVals(...args),
      }
    ];
  }
}

export default class TableSchema extends BaseUISchema {
  constructor(fieldOptions={}, nodeInfo, schemas, getPrivilegeRoleSchema, getColumns, initValues) {
    super({
      name: undefined,
      oid: undefined,
      spcoid: undefined,
      spcname: undefined,
      relowner: undefined,
      relacl: undefined,
      relhasoids: undefined,
      relhassubclass: undefined,
      reltuples: undefined,
      description: undefined,
      conname: undefined,
      conkey: undefined,
      isrepl: undefined,
      triggercount: undefined,
      relpersistence: undefined,
      fillfactor: undefined,
      toast_tuple_target: undefined,
      parallel_workers: undefined,
      reloftype: undefined,
      typname: undefined,
      labels: undefined,
      providers: undefined,
      is_sys_table: undefined,
      coll_inherits: [],
      hastoasttable: true,
      toast_autovacuum_enabled: 'x',
      autovacuum_enabled: 'x',
      primary_key: [],
      foreign_key: [],
      partitions: [],
      partition_type: 'range',
      is_partitioned: false,
      columns: [],
      ...initValues,
    });

    this.fieldOptions = fieldOptions;
    this.schemas = schemas;
    this.getPrivilegeRoleSchema = getPrivilegeRoleSchema;
    this.nodeInfo = nodeInfo;
    this.getColumns = getColumns;

    this.partitionKeysObj = new PartitionKeysSchema();
    this.partitionsObj = new PartitionsSchema(this.nodeInfo);
    this.constraintsObj = this.schemas.constraints();
    this.columnsSchema = this.schemas.columns();
    this.vacuumSettingsSchema = this.schemas.vacuum_settings();
  }

  get idAttribute() {
    return 'oid';
  }

  initialise(state) {
    this.changeColumnOptions(state.columns);
  }

  inSchemaWithModelCheck(state) {
    if(this.nodeInfo && 'schema' in this.nodeInfo) {
      return !this.isNew(state);
    }
    return false;
  }

  getTableOid(tabName) {
    // Here we will fetch the table oid from table name
    // iterate over list to find table oid
    for(const t of this.inheritedTableList) {
      if(t.label === tabName) {
        return t.tid;
      }
    }
    return;
  }

  // Check for column grid when to Add
  canAddRowColumns(state) {
    if(!this.inCatalog()) {
      // if of_type then disable add in grid
      if (!isEmptyString(state.typname)) {
        return false;
      }
    }
    return true;
  }

  // Check for column grid when to edit/delete (for each row)
  canEditDeleteRowColumns(colstate) {
    if (!isEmptyString(colstate.inheritedfrom)) {
      return false;
    }
    return true;
  }

  isPartitioned(state) {
    if(state.is_partitioned) {
      return true;
    }
    return this.inCatalog();
  }

  changeColumnOptions(columns) {
    let colOptions = (columns||[]).map((c)=>({label: c.name, value: c.name, image:'icon-column'}));
    this.constraintsObj.changeColumnOptions(colOptions);
    this.partitionKeysObj.changeColumnOptions(colOptions);
    this.partitionsObj.changeColumnOptions(colOptions);
  }

  get baseFields() {
    let obj = this;

    return [{
      id: 'name', label: gettext('Name'), type: 'text', noEmpty: true,
      mode: ['properties', 'create', 'edit'], readonly: this.inCatalog,
    },{
      id: 'oid', label: gettext('OID'), type: 'text', mode: ['properties'],
    },{
      id: 'relowner', label: gettext('Owner'), type: 'select',
      options: this.fieldOptions.relowner, noEmpty: true,
      mode: ['properties', 'create', 'edit'], controlProps: {allowClear: false},
      readonly: this.inCatalog,
    },{
      id: 'schema', label: gettext('Schema'), type: 'select',
      options: this.fieldOptions.schema, noEmpty: true,
      mode: ['create', 'edit'],
      readonly: this.inCatalog,
    },{
      id: 'spcname', label: gettext('Tablespace'),
      type: 'select', options: this.fieldOptions.spcname,
      mode: ['properties', 'create', 'edit'], deps: ['is_partitioned'],
      readonly: this.inCatalog,
    },{
      id: 'partition', type: 'group', label: gettext('Partitions'),
      mode: ['edit', 'create'], min_version: 100000,
      visible: function(state) {
        // Always show in case of create mode
        if (obj.isNew(state) || state.is_partitioned)
          return true;
        return false;
      },
    },{
      id: 'is_partitioned', label:gettext('Partitioned table?'), cell: 'switch',
      type: 'switch', mode: ['properties', 'create', 'edit'],
      min_version: 100000,
      readonly: function(state) {
        if (!obj.isNew(state))
          return true;
        return false;
      },
    },{
      id: 'is_sys_table', label: gettext('System table?'), cell: 'switch',
      type: 'switch', mode: ['properties'],
      disabled: this.inCatalog,
    },{
      id: 'description', label: gettext('Comment'), type: 'multiline',
      mode: ['properties', 'create', 'edit'], disabled: this.inCatalog,
    },{
      id: 'coll_inherits', label: gettext('Inherited from table(s)'),
      type: 'select', group: gettext('Columns'),
      deps: ['typname', 'is_partitioned'], mode: ['create', 'edit'],
      controlProps: { multiple: true, allowClear: false, placeholder: gettext('Select to inherit from...')},
      options: this.fieldOptions.coll_inherits,
      optionsLoaded: (res)=>obj.inheritedTableList=res,
      disabled: (state)=>{
        if(state.adding_inherit_cols || state.is_partitioned){
          return true;
        }
        if(!obj.inCatalog() && isEmptyString(state.typname)) {
          return false;
        }
        return true;
      },
      depChange: (state, source, topState, actionObj)=>{
        if(actionObj.type == SCHEMA_STATE_ACTIONS.SET_VALUE && actionObj.path[0] == 'coll_inherits') {
          return {adding_inherit_cols: true};
        }
        if(source[0] === 'is_partitioned' && state.is_partitioned) {
          for(const collTable of state.coll_inherits || []) {
            let removeOid = this.getTableOid(collTable);
            _.remove(state.columns, (col)=>col.inheritedid==removeOid);
          }

          return {
            coll_inherits: [],
          };
        }
      },
      deferredDepChange: (state, source, topState, actionObj)=>{
        return new Promise((resolve)=>{
          // current table list and previous table list
          let newColInherits = state.coll_inherits || [];
          let oldColInherits = actionObj.oldState.coll_inherits || [];

          let tabName;
          let tabColsResponse;

          // Add columns logic
          // If new table is added in list
          if(newColInherits.length > 1 && newColInherits.length > oldColInherits.length) {
            // Find newly added table from current list
            tabName = _.difference(newColInherits, oldColInherits);
            tabColsResponse = obj.getColumns({tid: this.getTableOid(tabName[0])});
          } else if (newColInherits.length == 1) {
            // First table added
            tabColsResponse = obj.getColumns({tid: this.getTableOid(newColInherits[0])});
          }

          if(tabColsResponse) {
            tabColsResponse.then((res)=>{
              resolve((state)=>{
                let finalCols = res.map((col)=>obj.columnsSchema.getNewData(col));
                finalCols = [...state.columns, ...finalCols];
                obj.changeColumnOptions(finalCols);
                return {
                  adding_inherit_cols: false,
                  columns: finalCols,
                };
              });
            });
          }

          // Remove columns logic
          let removeOid;
          if(newColInherits.length > 0 && newColInherits.length < oldColInherits.length) {
            // Find deleted table from previous list
            tabName = _.difference(oldColInherits, newColInherits);
            removeOid = this.getTableOid(tabName[0]);
          } else if (oldColInherits.length === 1 && newColInherits.length < 1) {
            // We got last table from list
            tabName = oldColInherits[0];
            removeOid = this.getTableOid(tabName);
          }
          if(removeOid) {
            resolve((state)=>{
              let finalCols = state.columns;
              _.remove(state.columns, (col)=>col.inheritedid==removeOid);
              obj.changeColumnOptions(finalCols);
              return {
                adding_inherit_cols: false,
                columns: finalCols
              };
            });
          }
        });
      },
    },{
      id: 'advanced', label: gettext('Advanced'), type: 'group',
      // visible: ShowAdvancedTab.show_advanced_tab,
      visible: true,
    },
    {
      id: 'rlspolicy', label: gettext('RLS Policy?'), cell: 'switch',
      type: 'switch', mode: ['properties','edit', 'create'],
      group: 'advanced', min_version: 90600,
      depChange: (state)=>{
        if (state.rlspolicy && this.origData.rlspolicy != state.rlspolicy) {
          pgAlertify().alert(
            gettext('Check Policy?'),
            gettext('Please check if any policy exist. If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified by other users')
          );
        }
      }
    },
    {
      id: 'forcerlspolicy', label: gettext('Force RLS Policy?'), cell: 'switch',
      type: 'switch', mode: ['properties','edit', 'create'], deps: ['rlspolicy'],
      group: 'advanced', min_version: 90600,
      disabled: function(state) {
        return !state.rlspolicy;
      },
      depChange: (state)=>{
        if(!state.rlspolicy) {
          return {forcerlspolicy: false};
        }
      }
    },
    {
      id: 'replica_identity', label: gettext('Replica Identity'),
      group: gettext('advanced'), type: 'text',mode: ['edit', 'properties'],
    }, {
      id: 'coll_inherits', label: gettext('Inherited from table(s)'),
      type: 'text', group: 'advanced', mode: ['properties'],
    },{
      id: 'inherited_tables_cnt', label: gettext('Inherited tables count'),
      type: 'text', mode: ['properties'], group: 'advanced',
      disabled: this.inCatalog,
    },{
      // Tab control for columns
      id: 'columns', label: gettext('Columns'), type: 'collection',
      group: gettext('Columns'),
      schema: this.columnsSchema,
      mode: ['create', 'edit'],
      disabled: function() {
        if(this.nodeInfo &&  'catalog' in this.nodeInfo)
        {
          return true;
        }
        return false;
      },
      deps: ['typname', 'is_partitioned'],
      depChange: (state, source)=>{
        if(source[0] === 'columns') {
          obj.changeColumnOptions(state.columns);
        }
      },
      canAdd: this.canAddRowColumns,
      canEdit: true, canDelete: true,
      // For each row edit/delete button enable/disable
      canEditRow: this.canEditDeleteRowColumns,
      canDeleteRow: this.canEditDeleteRowColumns,
      uniqueCol : ['name'],
      columns : ['name' , 'cltype', 'attlen', 'attprecision', 'attnotnull', 'is_primary_key', 'defval'],
      allowMultipleEmptyRow: false,
    },{
      // Here we will create tab control for constraints
      type: 'nested-tab', group: gettext('Constraints'),
      mode: ['edit', 'create'],
      schema: obj.constraintsObj,
    },{
      id: 'typname', label: gettext('Of type'), type: 'select',
      mode: ['properties', 'create', 'edit'], group: 'advanced', deps: ['coll_inherits'],
      disabled: (state)=>{
        if(!obj.inSchemaWithModelCheck(state) && isEmptyString(state.coll_inherits)) {
          return false;
        }
        return true;
      }, options: this.fieldOptions.typname, optionsLoaded: (res)=>{
        obj.ofTypeTables = res;
      },
      depChange: (state, source)=>{
        if(source[0] == 'typname' && !isEmptyString(state.typname)) {
          return {
            columns: [],
            primary_key: []
          };
        }
      },
      deferredDepChange: (state, source, topState, actionObj)=>{
        const setColumns = (resolve)=>{
          let finalCols = [];
          if(!isEmptyString(state.typname)) {
            let typeTable = _.find(obj.ofTypeTables||[], (t)=>t.label==state.typname);
            finalCols = typeTable.oftype_columns;
          }
          resolve(()=>{
            obj.changeColumnOptions(finalCols);
            return {
              columns: finalCols,
            };
          });
        };
        if(!isEmptyString(state.typname) && isEmptyString(actionObj.oldState.typname)) {
          return new Promise((resolve)=>{
            pgAlertify().confirm(
              gettext('Remove column definitions?'),
              gettext('Changing \'Of type\' will remove column definitions.'),
              function () {
                setColumns(resolve);
              },
              function() {
                resolve(()=>{
                  return {
                    typname: null,
                  };
                });
              }
            );
          });
        } else if(state.typname != actionObj.oldState.typname) {
          return new Promise((resolve)=>{
            setColumns(resolve);
          });
        } else {
          return Promise.resolve(()=>{});
        }
      },
    },
    {
      id: 'fillfactor', label: gettext('Fill factor'), type: 'int',
      mode: ['create', 'edit'], min: 10, max: 100,
      group: 'advanced',
      disabled: obj.isPartitioned,
    },{
      id: 'toast_tuple_target', label: gettext('Toast tuple target'), type: 'int',
      mode: ['create', 'edit'], min: 128, min_version: 110000,
      group: 'advanced',
      disabled: obj.isPartitioned,
    },{
      id: 'parallel_workers', label: gettext('Parallel workers'), type: 'int',
      mode: ['create', 'edit'], group: 'advanced', min_version: 90600,
      disabled: obj.isPartitioned,
    },
    {
      id: 'relhasoids', label: gettext('Has OIDs?'), cell: 'switch',
      type: 'switch', mode: ['properties', 'create', 'edit'],
      group: 'advanced',
      disabled: function() {
        if(obj.getServerVersion() >= 120000) {
          return true;
        }
        return obj.inCatalog();
      },
    },{
      id: 'relpersistence', label: gettext('Unlogged?'), cell: 'switch',
      type: 'switch', mode: ['properties', 'create', 'edit'],
      disabled: obj.inSchemaWithModelCheck,
      group: 'advanced',
    },{
      id: 'conname', label: gettext('Primary key'), cell: 'text',
      type: 'text', mode: ['properties'], group: 'advanced',
      disabled: this.inCatalog,
    },{
      id: 'reltuples', label: gettext('Rows (estimated)'), cell: 'text',
      type: 'text', mode: ['properties'], group: 'advanced',
      disabled: this.inCatalog,
    },{
      id: 'rows_cnt', label: gettext('Rows (counted)'), cell: 'text',
      type: 'text', mode: ['properties'], group: 'advanced',
      disabled: this.inCatalog,
      formatter: {
        fromRaw: ()=>{
          return 0;
        },
        toRaw: (backendVal)=>{
          return backendVal;
        },
      },
    },{
      id: 'relhassubclass', label: gettext('Inherits tables?'), cell: 'switch',
      type: 'switch', mode: ['properties'], group: 'advanced',
      disabled: this.inCatalog,
    },{
      type: 'nested-fieldset', label: gettext('Like'),
      group: 'advanced', mode: ['create'],
      schema: new LikeSchema(this.fieldOptions.like_relation),
    },{
      id: 'partition_type', label:gettext('Partition Type'),
      editable: false, type: 'select', controlProps: {allowClear: false},
      group: 'partition', deps: ['is_partitioned'],
      options: function() {
        var options = [{
          label: gettext('Range'), value: 'range',
        },{
          label: gettext('List'), value: 'list',
        }];

        if(obj.getServerVersion() >= 110000) {
          options.push({
            label: gettext('Hash'), value: 'hash',
          });
        }
        return Promise.resolve(options);
      },
      mode:['create'],
      min_version: 100000,
      disabled: function(state) {
        if (!state.is_partitioned)
          return true;
        return false;
      },
      readonly: function(state) {return !obj.isNew(state);},
    },
    {
      id: 'partition_keys', label:gettext('Partition Keys'),
      schema: obj.partitionKeysObj,
      editable: true, type: 'collection',
      group: 'partition', mode: ['create'],
      deps: ['is_partitioned', 'partition_type', 'typname'],
      canEdit: false, canDelete: true,
      canAdd: function(state) {
        if (obj.isNew(state) && state.is_partitioned)
          return true;
        return false;
      },
      canAddRow: function(state) {
        let columnsExist = false;

        var maxRowCount = 1000;
        if (state.partition_type && state.partition_type == 'list')
          maxRowCount = 1;

        if (state.columns?.length > 0) {
          columnsExist = _.some(_.map(state.columns, 'name'));
        }

        if(state.partition_keys) {
          return state.partition_keys.length < maxRowCount && columnsExist;
        }

        return true;
      }, min_version: 100000,
      depChange: (state, source, topState, actionObj)=>{
        if(state.typname != actionObj.oldState.typname) {
          return {
            partition_keys: [],
          };
        }
      }
    },
    {
      id: 'partition_scheme', label: gettext('Partition Scheme'),
      group: 'partition', mode: ['edit'],
      type: (state)=>({
        type: 'note',
        text: state.partition_scheme || '',
      }),
      min_version: 100000,
    },
    {
      id: 'partition_key_note', label: gettext('Partition Keys'),
      type: 'note', group: 'partition', mode: ['create'],
      text: [
        '<ul><li>',
        gettext('Partition table supports two types of keys:'),
        '</li><li>',
        '<strong>', gettext('Column: '), '</strong>',
        gettext('User can select any column from the list of available columns.'),
        '</li><li>',
        '<strong>', gettext('Expression: '), '</strong>',
        gettext('User can specify expression to create partition key.'),
        '</li><li>',
        '<strong>', gettext('Example: '), '</strong>',
        gettext('Let\'s say, we want to create a partition table based per year for the column \'saledate\', having datatype \'date/timestamp\', then we need to specify the expression as \'extract(YEAR from saledate)\' as partition key.'),
        '</li></ul>',
      ].join(''),
      min_version: 100000,
    },
    {
      id: 'partitions', label: gettext('Partitions'),
      schema: this.partitionsObj,
      editable: true, type: 'collection',
      group: 'partition', mode: ['edit', 'create'],
      deps: ['is_partitioned', 'partition_type', 'typname'],
      depChange: (state, source)=>{
        if(['is_partitioned', 'partition_type', 'typname'].indexOf(source[0]) >= 0 && obj.isNew(state)){
          return {'partitions': []};
        }
      },
      canEdit: true, canDelete: true,
      customDeleteTitle: gettext('Detach Partition'),
      customDeleteMsg: gettext('Are you sure you wish to detach this partition?'),
      columns:['is_attach', 'partition_name', 'is_default', 'values_from', 'values_to', 'values_in', 'values_modulus', 'values_remainder'],
      canAdd: function(state) {
        if (state.is_partitioned)
          return true;
        return false;
      },
      min_version: 100000,
    },
    {
      id: 'partition_note', label: gettext('Partitions'),
      type: 'note', group: 'partition', mode: ['create'],
      text: [
        '<ul><li>',
        '<strong>', gettext('Create a table: '), '</strong>',
        gettext('User can create multiple partitions while creating new partitioned table. Operation switch is disabled in this scenario.'),
        '</li><li>',
        '<strong>', gettext('Edit existing table: '), '</strong>',
        gettext('User can create/attach/detach multiple partitions. In attach operation user can select table from the list of suitable tables to be attached.'),
        '</li><li>',
        '<strong>', gettext('Default: '), '</strong>',
        gettext('The default partition can store rows that do not fall into any existing partition’s range or list.'),
        '</li><li>',
        '<strong>', gettext('From/To/In input: '), '</strong>',
        gettext('From/To/In input: Values for these fields must be quoted with single quote. For more than one partition key values must be comma(,) separated.'),
        '</li><li>',
        '<strong>', gettext('Example: From/To: '), '</strong>',
        gettext('Enabled for range partition. Consider partitioned table with multiple keys of type Integer, then values should be specified like \'100\',\'200\'.'),
        '</li><li>',
        '<strong>', gettext('In: '), '</strong>',
        gettext('Enabled for list partition. Values must be comma(,) separated and quoted with single quote.'),
        '</li><li>',
        '<strong>', gettext('Modulus/Remainder: '), '</strong>',
        gettext('Enabled for hash partition.'),
        '</li></ul>',
      ].join(''),
      min_version: 100000,
    },
    {
      // Here - we will create tab control for storage parameters
      // (auto vacuum).
      type: 'nested-tab', group: gettext('Parameters'),
      mode: ['edit', 'create'], deps: ['is_partitioned'],
      schema: this.vacuumSettingsSchema,
    },
    {
      id: 'relacl_str', label: gettext('Privileges'), disabled: this.inCatalog,
      type: 'text', mode: ['properties'], group: gettext('Security'),
    },
    {
      id: 'relacl', label: gettext('Privileges'), type: 'collection',
      group: gettext('Security'), schema: this.getPrivilegeRoleSchema(['a','r','w','d','D','x','t']),
      mode: ['edit', 'create'], canAdd: true, canDelete: true,
      uniqueCol : ['grantee'],
    },{
      id: 'seclabels', label: gettext('Security labels'), canEdit: false,
      schema: new SecLabelSchema(), editable: false, canAdd: true,
      type: 'collection', min_version: 90100, mode: ['edit', 'create'],
      group: gettext('Security'), canDelete: true, control: 'unique-col-collection',
    },{
      id: 'vacuum_settings_str', label: gettext('Storage settings'),
      type: 'multiline', group: 'advanced', mode: ['properties'],
    }];
  }

  validate(state, setError) {
    if (state.is_partitioned && this.isNew(state) &&
        (!state.partition_keys || state.partition_keys && state.partition_keys.length <= 0)) {
      setError('partition_keys', gettext('Please specify at least one key for partitioned table.'));
      return true;
    }
    return false;
  }
}