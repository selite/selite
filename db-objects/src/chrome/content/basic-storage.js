/*  Copyright 2011, 2012, 2013 Peter Kehl
    This file is part of SeLite DbStorage.

    SeLite DB Storage is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    SeLite DB Storage is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with SeLite DB Storage.  If not, see <http://www.gnu.org/licenses/>.
*/

"use strict";

// This is a Selenium IDE Core extension.
// This file uses SQLConnectionManager extension and SeLite Misc extension.

Components.utils.import("chrome://selite-sqlite-connection-manager/content/SqliteConnectionManager.js");

/** This provides low-level data functions. It's a constructor of an object,
 *  but the code is procedural. The reason to have it as an object is not to
 *  have name clashes with functions in other files. See SeLite DB Objects for OOP layer on top of this.
 **/
function Storage() {
    this.parameters= new SQLiteConnectionParameters();
    this.parameters.errorHandler= alert;
    this.connection= null;
}

/** Open a new SQLite connection, as specified in parameters. Set it as the connection for this object.
 * Note: if you use connection.clone(), it won't inherit PRAGMA locking_mode
 * @return the new connection
 */
Storage.prototype.open= function() {
    this.connection= this.parameters.connect();
}

/** This gets the list of result column names (e.g. names after the last space, if present; otherwise after the last dot, if present)
 *  out of column expressions/parts.
 *  @param array of strings
 *  @return array of strings
 *  For internal use only.
 **/
Storage.prototype.fieldNames= function( columnParts ) {
    var result= [];
    for( var i=0; i<columnParts.length; i++ ) {
        result[i]= this.fieldName( columnParts[i] );
    }
    return result;
}

Storage.prototype.fieldName= function( columnPart ) {
    var result= columnPart.trim();
    var lastSpaceIndex= result.lastIndexOf(' ');
    if( lastSpaceIndex>0 ) {
        result= result.substr( lastSpaceIndex+1 );
    }
    else {
        var lastDotIndex= result.lastIndexOf('.');
        if( lastDotIndex>0 ) {
            result= result.substr( lastDotIndex+1 );
        }
    }
    // Remove any leading and trailing back apostrophe:
    if( result.length>1 && result[0]=='`' && result[result.length]=='`' ) {
        result= result.substr( 1, result.length-2 );
    }
    return result;
}

/** This collects fields from within SELECT... FROM part of the given query.
 *  For internal use only.
 **/
Storage.prototype.fieldParts= function( query ) {
    // Make lowercase. Make one or more whitespaces be a single space - so that we can locate 'select' and 'from' etc. easily.
    query= query.toLowerCase().replace( /\s+/g, ' ');
    var selectStart= query.indexOf( 'select ');
    if( selectStart<0 ) {
        throw "Query \"" +query+ "\" doesn't contain SELECT.";
    }
    var fromStart= query.indexOf( ' from ', selectStart );
    if( fromStart<0 ) {
        throw "Query \"" +query+ "\" doesn't contain FROM.";
    }
    var selectFrom= query.substring( selectStart+7, fromStart );
    if( selectFrom.indexOf('*')>=0 ) {
        throw "Query \"" +query+ "\" selects columns using *.";
    }
    var fieldParts= selectFrom.split( / ?, ?/ );
    var fields= [];
    for( var i=0; i<fieldParts.length; i++ ) {
        var part= fieldParts[i];
        if( part==='' ) {
            throw "Query \"" +query+ "\" has an empty " +(i+1)+ "-th part of SELECT list.";
        }
        var lastSpace= part.lastIndexOf( ' ' );
        if( lastSpace>=0 ) {
            if( lastSpace==part.length-1 ) {
                throw "Query \"" +query+ "\" has strange " +(i+1)+ "-th part of SELECT list.";
            }
            part= part.substr( lastSpace+1);
        }
        fields.push( part );
    }
    if( fields.length==0 ) {
        throw "Query \"" +query+ "\" has an empty SELECT list.";
    }
    return fields;
}

/** @return string SQL condition containing the given first and second condition(s), whichever of them is present.
 *   This doesn't put oval parenthesis around the condition parts.
 **/
Storage.prototype.sqlAnd= function( first, second ) {
    var firstIsSet= first || first===0;
    var secondIsSet= second || second===0;
    if( firstIsSet ) {
        return secondIsSet ? first+' AND '+second : first;
    }
    return secondIsSet ? second : '';
}

/** @param string query SQL query
 *  @param array fields Optional; array of strings SQL fields (columns) to collect; must match case-sensitively columns
 *  coming from the query. If not present,
 *  then this function will try to collect the column names, providing
 *  - all required column names are listed, there's no *
 *  - none of the column names is string 'FROM' (case insensitive)
 *  - there are no sub-selects between SELECT...FROM
 *  @param object bindings Optional; Object (serving as associative array) of parameters to bind,
 *  i.e. bindings to replace placeholders in the query.
 *  See https://developer.mozilla.org/en/Storage#Binding_One_Set_of_Parameters
 *  @return array of objects, one per DB row, each having DB column names as fields; empty array if no matching rows
 *  @throws error on failure
 **/
Storage.prototype.select= function( query, fields, bindings ) {
    bindings= bindings || {};
    if( !fields ) {
        fields= fieldNames( fieldParts( query ) );
    }
    var stmt= this.connection.createStatement( query );
    for( var field in bindings ) {
        try { stmt.params[field]= bindings[field]; }
        catch(e) {
            throw 'select(): Cannot set field "' +field+ '" to value "' +bindings[field]+ '" - SQLite/schema limitation.';
        }
    }
    var result= [];
    try {
        // MDN Docs on synchronous API are not detailed enough. If iterating over SELECT with stmt.executeStep()
        // - you can't use: for( var field in stmt.row ) - so you need to know the list of columns
        // - fields are accessbile via stmt.row.<column-name> only before you reset the statement!
        while( stmt.executeStep() ) {
            var resultRow= {};
            for( var i=0; i<fields.length; i++ ) {
                resultRow[ fields[i] ]= stmt.row[ fields[i] ];
            }
            result.push( resultRow );
        }
    }
    finally {
        stmt.reset();
    }
    return result;
}

/** It selects 1 row from the DB. If there are no such rows, or more than one, then it throws an error.
 *  @param string query full SQL query
 *  @param array fields Optional (unless you use SELECT * etc.); see the same parameter of select().
 *  @return Associative array (i.e. object) for the row.
 *  @throws error on failure
 **/
Storage.prototype.selectOne= function( query, fields, bindings ) {
    var rows= this.select( query, fields, bindings );
    if( rows.length!=1 ) {
        throw "Query \"" +query+"\" was supposed to return one result, but it returned " +rows.length+ " of them.";
    }
    return rows[0];
}

/** @param string query SQL query
 *  @param object bindings Optional; see select()
 *  @return void
 *  @throws error on failure
 **/
Storage.prototype.execute= function( query, bindings ) {
    if( bindings==null ) {
        this.connection.executeSimpleSQL( query );
    }
    else {
        var stmt= this.connection.createStatement( query );
        for( var field in bindings ) {
            stmt.params[field]= bindings[field];
        }
        stmt.execute();
    }
}

/** Get one record from the DB.
 * @param object params Object just like the same-called parameter for getRecords()
 * @return object of the DB record
 * @throws error on failure, or if no such record, or if more than 1 matching record
 **/
Storage.prototype.getRecord= function( params ) {
    var records= this.getRecords( params );
    if( records.length!=1 ) {
        throw "Expected to find one matching record in DB, but found " +records.length+ " of them.";
    }
    return records[0];
}

/** Get (matching) records from the DB.
 * @param object params Object in form {
 *   table: string table name,
 *   columns: mixed - one of
 *     - array of string table names; or
 *     - string containing columns names separated by a comma
 *        or by a comma and space(s). The column names can be simple e.g. 'id'; or SQL column labels e.g. 'created created_time'
 *        or 'created AS created_time', or 'sq-expression-here column-alias-here'
 *        - but if it's not a simple name then you have to use the alias part; or
 *     - object containg DB column names as keys (field names), and their aliases as values or true/1 if no alias to use (then it uses the column name).
 *   joins: optional, array of objects [
 *      {
 *        table: string table name (it may be '<tablename> <tablealias>', then you don't need to use alias field, but alias field is preferred),
 *        alias: string table alias (optional),
 *        type: string 'INNER LEFT' etc.; optional,
 *        on: string join condition without 'ON' itself, optional
 *      }
 *   ],
 *   matching: optional, object {
 *     // String values will be quoted, unless they start with ':' and contain a parameter name listed in parameterNames.
 *     // Javascript null value will generate IS NULL, other values generate = comparison.
 *     fieldXY: value, fieldPQ: value...
 *   },
 *   condition: optional, string SQL condition, properly quoted. Both 'matching' and 'condition'
 *     may be used at the same time, then they are AND-ed,
 *   parameters: object serving as an associative array, listing parameters in form {string parameter-name: mixed parameter-value, ...}. Optional.
 *   parameterNames: array of strings which are acceptable parameter names. Optional, but should be set if you want 'parameters' to be applied.
 *   sort: optional, string column name to sort by
 *   sortDirection: optional, string direction to sort by; 'ASC' by default (if sorting)
 *   debugQuery: optional, use true if you'd like it to show the query in a popup
 *   debugResult: optional, use true if you'd like it to show the result in a popup
 * }
 **/
Storage.prototype.getRecords= function( params ) {
    var parameterNames= params.parameterNames || {};
    if( typeof params.columns=='string' ) {
        var columnsString= params.columns;
        var columnsList= params.columns.split( / ?, ?/ );
    }
    else if( params.columns instanceof Array ) {
        var columnsString= params.columns.join(', ');
        var columnsList= params.columns;
    }
    else if( typeof params.columns ==='object' ) {
        var columnsString= '';
        var columnsList= [];
        for( var column in params.columns ) {
            if( columnsString ) {
                columnsString+= ', ';
            }
            if( typeof params.columns[column] ==='string' ) {
                columnsString+= column+ ' ' +params.columns[column];
                columnsList.push( params.columns[column] );
            }
            else
            if( params.columns[column]===true || params.columns[column]===1 ) {
                columnsString+= column;
                columnsList.push( this.fieldName(column) );
            }
            else {
                throw new Error( "getRecords(): column '" +column+ "' has an unsupported non-string alias " +params.columns[column] );
            }
        }
    }
    else throw new Error( "params.columns not recognised" );
    columnsList= this.fieldNames( columnsList );
    var query= "SELECT " +columnsString+ " FROM " +params.table;

    if( typeof params.joins !=='undefined' ) {
        for( var i=0; i<params.joins.length; i++ ) {
            var join= params.joins[i];
            if( typeof join.type !=='undefined' ) {
                query+= ' ' +join.type;
            }
            query+= ' JOIN ' +join.table;
            if( typeof join.alias !=='undefined' ) {
                query+= ' ' +join.alias;
            }
            if( typeof join.on !=='undefined' ) {
                query+= " ON " +join.on;
            }
        }
    }

    var conditionParts= [];
    if( typeof params['matching'] !=='undefined' && !isEmptyObject(params['matching']) ) {
        for( var field in params.matching ) {
            var matchedValue= params.matching[field];
            matchedValue= typeof matchedValue==='string' && matchedValue.length>1
                && matchedValue[0]===':' && parameterNames.indexOf(matchedValue.substr(1))>=0
                ? matchedValue // Don't quote SQLite parameters :xyz - SQLite will escape & quote automatically
                : this.quote( matchedValue );
            if( matchedValue!==null ) {
                conditionParts.push( field+ '=' +matchedValue );
            }
            else {
                conditionParts.push( field+ ' IS NULL' );
            }
        }
    }
    if( typeof params['condition'] !=='undefined' && params['condition']!=='' && params['condition']!=null ) {
        conditionParts.push( '('+params.condition+')' );
    }
    if( conditionParts.length ) {
        query+= " WHERE " +conditionParts.join(' AND ');
    }
    if( typeof params['sort']!=='undefined' && params.sort ) {
        var sortDirection= (typeof params['sortDirection']=='undefined' || !params.sortDirection)
            ? 'ASC'
            : params.sortDirection;
        query+= " ORDER BY " +params.sort+ ' ' +sortDirection;
    }
    if( typeof params.debugQuery!=='undefined' && params.debugQuery ) {
        alert( query );
    }

    var result= this.select( query, columnsList, params.parameters );
    if( typeof params.debugResult!=='undefined' && params.debugResult ) {
        alert( rowsToString(result) );
    }
    return result;
}

/** Update (matching) records in the DB.
 * @param object params Object in form {
 *   table: string table name,
 *   entries: object (serving as an associative array) with the columns to update in the given table. In form
 *       { field: value,
 *         field: value...
 *       }. The values will be quoted.
 *   fieldsToProtect: optional, array of strings, which are names of fields whose
 *       values won't be quoted. Use for SQL expressions or for values that were already securely quoted
 *   matching: optional, object (all values will be quoted) {
 *     fieldXY: value, fieldPQ: value...
 *   },
 *   condition: optional, string SQL condition, properly quoted. Both 'matching' and 'condition'
 *     may be used at the same time, then they are AND-ed.
 *   debugQuery: optional, use true if you'd like it to show the query in a popup
 * }
 * @return void
 * @throws an error on failure
 **/
Storage.prototype.updateRecords= function( params ) {
    var fieldsToProtect= typeof params.fieldsToProtect!=='undefined'
        ? params.fieldsToProtect
        : [];
    var entries= this.quoteValues( params.entries, fieldsToProtect );

    var setPairs= [];
    for( var field in entries ) {
        setPairs.push( field+ '=' +entries[field] );
    }
    if( !setPairs.length ) {
        LOG.error( 'updateRecords() requires params.entries not to be empty.' );
    }
    var query= "UPDATE " +params.table+ " SET " +setPairs.join(', ');

    var conditionParts= [];
    if( typeof params['matching'] !=='undefined' ) {
        for( var field in params.matching ) {
            conditionParts.push( field+ '=' +this.quote( params.matching[field] ) );
        }
    }
    if( typeof params['condition'] !=='undefined' && params['condition']!=='' && params['condition']!=null ) {
        conditionParts.push( '('+params.condition+')' );
    }
    if( conditionParts.length ) {
        query+= " WHERE " +conditionParts.join(' AND ');
    }
    
    if( typeof params.debugQuery!=='undefined' && params.debugQuery ) {
        alert( query );
    }
    var stmt= this.connection.createStatement( query );
    stmt.execute();
}

/** Update a in the DB, matching it by 'id' field (i.e. params.entries.id).
 * @param object params Object in form {
 *   table: string table name,
 *   primary: string primary key name, optional - 'id' by default,
 *   entries: object (serving as an associative array) with the columns to update in the given table. In form
 *       { field: value,
 *         field: value...
 *       }. The values will be quoted.
 *   entries must contain '<primary>' field; that will be matched in the DB (and indeed, it won't be updated).
 *   fieldsToProtect: optional, array of strings, which are names of fields whose
 *       values won't be quoted. Use for SQL expressions or for values that were already securely quoted
 *   debugQuery: optional, use true if you'd like it to show the query in a popup
 *   }
 * @return void
 * @throws an error on failure
 */
Storage.prototype.updateRecordByPrimary= function( params ) {
    var primaryKey= params.primary || 'id';
    var copiedParams= objectClone( params, ['table', 'entries', 'fieldsToProtect', 'debugQuery'], ['table', 'entries'] );
    if( typeof copiedParams.entries[primaryKey] ==='undefined' ) {
        throw new Error( "updateRecordByPrimary(): params.entries." +primaryKey+ " is not set." );
    }
    copiedParams.entries= objectClone( copiedParams.entries );
    copiedParams.matching= new Settable().set( primaryKey, copiedParams.entries[primaryKey] );
    delete copiedParams.entries[primaryKey];
    this.updateRecords( copiedParams );
}

/** Delete a record in the DB, matching it by the given field and its value.
 *  The value will be quoted and it must not be null.
 * @return void
 * @throws an error on failure
 */
Storage.prototype.deleteRecordByPrimary= function( table, field, value ) {
    var query= "DELETE FROM " +table+ " WHERE " +field+ "=" +this.quote(value);
    var stmt= this.connection.createStatement( query );
    stmt.execute();
}

/**Insert the  record into the DB.
 * @param object params Object in form {
 *   table: string table name,
 *   entries: object (serving as an associative array) to store in the given table. In form
 *       { field: value,
 *         field: value...
 *       }. The values will be quoted.
 *   fieldsToProtect: optional, array of strings, which are names of fields whose
 *       values won't be quoted. Use for SQL expressions or for values that were already securely quoted
 *   debugQuery: optional; use true if you'd like to show the query in a popup
 * }
 * @return void
 * @throws an error on failure
 */
Storage.prototype.insertRecord= function( params ) {
    var fieldsToProtect= typeof params.fieldsToProtect!=='undefined'
        ? params.fieldsToProtect
        : [];
    var entries= this.quoteValues( params.entries, fieldsToProtect );
    var columns= [];
    var values= [];
    for( var field in entries ) {
        columns.push( field );
        values.push( entries[field] );
    }
    var query= 'INSERT INTO ' +params.table+ '(' +columns.join(', ')+ ') VALUES ('+
        values.join(', ')+ ')';
    if( typeof params.debugQuery!=='undefined' && params.debugQuery ) {
        alert( query );
    }
    var stmt= this.connection.createStatement( query );
    stmt.execute();
}

/** This returns value of 'id' (or given column) of the last inserted/updated record.
 *  It only works when called right after the relevant INSERT statement, i.e. there must
 *  be no other INSERT statements before calling this, even if those INSERT statements would
 *  insert into a different table.
 *  It requires the DB table not to have any column called "rowid", "oid" or "_rowid_".
 *  See http://sqlite.org/lang_corefunc.html and http://sqlite.org/lang_createtable.html#rowid
 *  @param string table table name; it must be the table that was used with INSERT/UPDATE.
 *  @param string column Name of the column; optional - 'id' by default
 *  @return value of 'id' (or requested) column
*/
Storage.prototype.lastInsertId= function( table, column ) {
    column= column || 'id';
    var query= "SELECT " +column+ " FROM " +table+ " WHERE rowid=last_insert_rowid()";
    var record= this.selectOne( query, [column] );
    return record[column];
}

/** This adds enclosing apostrophes and doubles any apostrophes in the given value, if it's a string.
 *  <br>It does add enclosing apostrophes around Javascript strings "null" or "NULL" etc! So use Javascript null instead.
 *  Use SqlExpression if you don't want quotes to be added.
 *  <br>For Javascript null, it returns unqouted string 'NULL'. That way we can pass values part of the result of quoteValues()
 *  (which returns an array of quoted items) through Array.join(). Otherwise, if we kept Javascript null values as they were,
 *  we couldn't use Array.join(), because it uses empty strings for Javascript nulls! See functions that call quoteValues().
 */
Storage.prototype.quote= function( value ) {
    if( value===null ) {
        return 'NULL';
    }
    if( value instanceof SqlExpression ) {
        return ''+value;
    }
    return "'" +(''+value).replace( "'", "''" )+ "'";
}

/** Use instances of SqlExpression so that they don't get quoted/escaped by quote() and quoteValues().
 **/
function SqlExpression( string ) {
    this.string= string;
}
SqlExpression.prototype.toString= function() {
    return this.string;
};

/** This adds enclosing apostrophes and doubles any apostrophes in values in entries for SQLite. See quote() for details on escaping.
 *  @param mixed entries it can be an array (created using new Array() or [...]), or an object {...} serving as an associative array
 *  @param array fieldsToProtect Optional array of strings, which are field (column) names for fields that shouldn't be quoted. Use it
 *  if passing SQL expressions for their values. fieldToProtect has only effect if entries is an object.
 *  @return new array or object, based on the original, with the treated values. Original array/object is not modified.
 **/
Storage.prototype.quoteValues= function( entries, fieldsToProtect ) {
    if( typeof entries !='object' ) {
        throw "quoteValues(): parameter should be an object or array, but it was " +values;
    }
    if( entries instanceof Array ) {
        var result= [];
        for( var i=0; i<entries.length; i++ ) {
            result[i]= this.quote( entries[i] );
        }
    }
    else {
        fieldsToProtect= fieldsToProtect || [];
        var result= {};
        for( var field in entries ) {
            if( fieldsToProtect.indexOf(field)>=0 ) {
                result[field]= entries[field];
            }
            else {
                result[field]= this.quote( entries[field] );
            }
        }
    }
    return result;
}

/** Used to generate object parts of 'columns' part of the parameter to RecordSetFormula() constructor, if your table names are not constants,
    i.e. you have a configurable table prefix string, and you don't want to have a string variable for each table name itself, but you want
    to refer to .name property of the table object. Then your table name is not string constant, and you can't use string runtime expressions
    as object keys in anonymous object construction {}. That's when you can use new Settable().set( tableXYZ.name, ...).set( tablePQR.name, ...)
    as the value of 'columns' field of RecordSetFormula()'s parameter.
    Its usage assumes that no table name (and no value for parameter field) is 'set'.
*/
function Settable() {
    if( arguments.length>0 ) {
        throw new Error( "Constructor Settable() doesn't use any parameters." );
    }
}
// I don't want method set() to show up when iterating using for( .. in..), therefore I use defineProperty():
Object.defineProperty( Settable.prototype, 'set', {
        value: function( field, value ) {
            this[field]= value;
            return this;
        }
} );

/** @TODO DOC We use synchronous DB API. That's because
 *  - with asynchronous API we'd have to wait for the query to finish before moving to next Selenium test step
 *  -- that would get complicated if the current steps involves multiple DB queries/operations. It would involve
 *  a chain of handler functions.
 *  - the API itself is a bit easier to use
 *  -- no need for callback handler functions
 *  -- when using executeStep() with SELECT, the rows are objects with fields named after DB columns
 *  When using asynchronous API with SELECT
 *  - the rows don't contain object fields named after DB columns,
 *  so you must use methods to access the fields - see https://developer.mozilla.org/en/mozIStorageStatement#executeAsync()
 *  and https://developer.mozilla.org/en/mozIStorageRow
 *  - handleResult() callback may be called several times per same statement!
 */
var EXPORTED_SYMBOLS= ['Storage', 'SqlExpression', 'Settable'];