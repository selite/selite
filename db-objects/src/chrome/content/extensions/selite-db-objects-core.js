"use strict";

Components.utils.import( "chrome://selite-db-objects/content/Db.js" ); // this loads 'SeLiteData' object into Selenium Core scope, so that it can be used by Selenese
Components.utils.import( "chrome://selite-db-objects/content/DbStorage.js" );
Components.utils.import( "chrome://selite-db-objects/content/DbObjects.js" );
Components.utils.import( "chrome://selite-db-objects/content/DbFunctions.js" );

// Following assignments is purely for JSDoc.
/** @class */
Selenium= Selenium;

/** This is not called getRecord, because then autogenerated storeRecord would be confusing/counter-intuitive: it could imply that it's storing something in the DB, while it would be retrieving a record from the DB and storing it in a stored variable.
 * @param {object} info
 * @returns {object}
 * */
Selenium.prototype.getReadRecord= function getReadRecord( info, dontNarrow=false ) {
    /** @type {SeLiteData.Table} */
    var table;
    /** @type SeLiteData.RecordSetFormula*/
    var formula;
    LOG.debug( 'getReadRecord info: ' +typeof info+ ': ' +SeLiteMisc.objectToString(info, 2));
    if( 'table' in info ) {
        table= info.table;
        table instanceof SeLiteData.Table || SeLiteMisc.fail( 'info.table must be an instance of SeLiteData.Table');
        formula= table.formula();
    }
    else if( 'formula' in info ) {
        formula= info.formula;
        formula instanceof SeLiteData.RecordSetFormula || SeLiteMisc.fail( 'info.formula must be an instance of SeLiteData.RecordSetFormula');
        table= formula.table;
    }
    else {
        SeLiteMisc.fail('getReadRecord() expects info.table or info.formula to be present.');
    }
    /**@type {object}*/var matchingPairs= SeLiteMisc.objectClone(info, table.columns );
    delete matchingPairs.info;
    delete matchingPairs.formula;
    // Following check depends on requirement that only one of info.table or info.formula is present
    Object.keys(matchingPairs).length===Object.keys(info).length-1 || SeLiteMisc.fail( 'There are some field(s) in info.matchingPairs that are not present in table/formula definition.' );

    var selecting= formula.select( matchingPairs, dontNarrow, /*sync:*/false );
    var validating= selecting.then( records => {
        var record= null;
        for( var key in records ) { // Return the only record, if any:
            if( record!==null ) {
                throw new Error( 'There is more than one record.' );
            }
            record= records[key];
            LOG.debug( 'getReadRecord: ' +records );
            LOG.debug( 'record: ' +SeLiteMisc.objectToString(record, 2) );
            return record;
        }
        throw new Error( "There are no records.");
    } );
    return this.handlePromise( validating );
};

/** @param {object} recordObject
 *  @param {SeLiteData.Table} table
 *  @return {Promise} Promise of a record
 * */
Selenium.insertRecord= function insertRecord( recordObject, table) {
    var record= new SeLiteData.Record(recordObject);
    var promise= table.insert( record, /*sync:*/false );
    if( typeof table.primary==='string' && SeLiteMisc.field(record, table.primary)!==undefined ) {
        promise= promise.then(
            ignored => recordObject[ table.primary ]= storedVars.insertedRecordKey= record[table.primary]
        );
    }
    return promise;
};

/** Insert a record. Update primary key in recordObject, if it's one column-based and it was not specified (hence it was autogenerated).
 *  @param {object} recordObject
 *  @param {SeLiteData.Table} table
 */
Selenium.prototype.doInsertRecord= function doInsertRecord( recordObject, table) {
    return this.handlePromise( Selenium.insertRecord(recordObject, table) );
};

/** @param {string|function} recordKeyAttributeLocator
 *  @param {object} compound { object record, SeLiteData.Table table}
 * */
Selenium.prototype.doInsertCaptureKey= function doInsertCaptureKey( recordKeyAttributeLocator, compound ) {
    !( compound.table.primary in compound.record ) || SeLiteMisc.fail( "Expected to generate or capture primary key for table " +compound.table.name+ ", but it was already set to a " +compound.record[compound.table.primary]+ '.' );
    var capturedPrimaryValue= typeof recordKeyLocator==="string"
        ? this.browserbot.findAttribute( recordKeyLocator )
        : recordKeyLocator( this );
    var settings= SeLiteSettings.Module.forName( 'extensions.selite-settings.common' );
    var narrowBy= settings.getField( 'narrowBy' ).getDownToFolder();
    var alwaysTestGeneratingKeys= settings.getField( 'alwaysTestGeneratingKeys' ).getDownToFolder();
    if( narrowBy && !alwaysTestGeneratingKeys ) {
        compound.record[ compound.table.primary ]= capturedPrimaryValue;
    }
    // The following sets compound.record[ compound.table.primary ], if it was not set already.
    var inserting= Selenium.insertRecord( compound.record, compound.table);
    
    if( !narrowBy || alwaysTestGeneratingKeys ) {
        inserting= inserting.then(
            ignored =>
            capturedPrimaryValue===compound.record[ compound.table.primary ] || SeLiteMisc.fail( "Captured primary key value for table " +compound.table.name+ ": " +capturedPrimaryValue+ " differs to generated value: " +compound.record[ compound.table.primary ] )
        );
    }
    this.handlePromise( inserting );
};
