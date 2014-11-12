/************************************************************
 *                                                          *
 *  Contents of file Copyright (c) Moogsoft Inc 2010        *
 *                                                          *
 *----------------------------------------------------------*
 *                                                          *
 *  WARNING:                                                *
 *  THIS FILE CONTAINS UNPUBLISHED PROPRIETARY              *
 *  SOURCE CODE WHICH IS THE PROPERTY OF MOOGSOFT INC AND   *
 *  WHOLLY OWNED SUBSIDIARY COMPANIES.                      *
 *  PLEASE READ THE FOLLOWING AND TAKE CAREFUL NOTE:        *
 *                                                          *
 *  This source code is confidential and any person who     *
 *  receives a copy of it, or believes that they are viewing*
 *  it without permission is asked to notify Phil Tee       *
 *  on 07734 591962 or email to phil@moogsoft.com.          *
 *  All intellectual property rights in this source code    *
 *  are owned by Moogsoft Inc.  No part of this source      *
 *  code may be reproduced, adapted or transmitted in any   *
 *  form or by any means, electronic, mechanical,           *
 *  photocopying, recording or otherwise.                   *
 *                                                          *
 *  You have been warned....so be good for goodness sake... *
 *                                                          *
 ************************************************************/
//
// Ok - we need the event responder
//
var events      = MooBot.loadModule('Events');
var moogdb      = MooBot.loadModule('MoogDb');
var logger      = MooBot.loadModule('Logger');
var constants   = MooBot.loadModule('Constants');
var externalDb  = MooBot.loadModule('ExternalDb');

// Register the new event handler. 

events.onEvent("newEvent",constants.eventType("Event")).listen();


//
// Database detailed fined in external_db_details.
//

//
// Constructors
//

var MaintRecord=function() {

	this.entity="";
	this.entity_type="entity";
	this.maint_mode="";
	this.status="";
	this.start_time=Math.round(Date.now() / 1000);
	this.end_time=0;
	this.description="";
	this.external_id="";
	this.updated_by="";
};

//
// Global lookup data.
//

// These fields are the minimum required. 

var mandatory_fields=[ "entity" , "maint_mode" , "status" ];

// These fields are lookups, save SQL queries for each
// event 
// May be moved to constants loaded on first event. 

var lookups={
		"entity_type"	:  {	
			"entity" 	: true,
			"regex_entity" 	: true,
			"regex_ip"	: true,
			"subnet"	: true
		},
		"maint_mode"	: {
			"maintenance"	: true,
			"blackout"	: true,
			"hibernation"	: true
		},
		"status" : {
			"enabled"	: true,
			"disabled"	: true
		}
};
			
		

function newEvent(event,response) 
{
	
	logger.info("MAINTMODE: Start");

	// Establish a connection to the database - best practice is witihn the function
	// not at the top level. 

	// Config held in the global db config file. 
	var maintModeConnection= externalDb.connect("maintMode");

	if ( !maintModeConnection )  {

		logger.warning("maintModeAB: Unable to establish a connection to maint mode database");
		response.output("Alert not created");
		response.retcode(-1);
    		return;
	}


	// 
	// Extract the required fields from the event.
	// 


	// Parse the data from the event. 

	var maintModeData;
	var eventOverflow;
	
	logger.info("maintModeAB: Evaluating " + event.value("overflow"));
	try {
		eventOverflow=JSON.parse(event.value("overflow"));
	}
	catch(e) {
		logger.warning("maintModeAB: Could not parse event overflow - " + e);
	}

	if ( !eventOverflow || !eventOverflow.maintModeData ) {
	
		logger.warning("maintModeAB: Could not find any maintenance data in the overflow payload - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	}

	//
	// Mandatory fields:
	// entity : a match to an entity.
	// type : one of "blackout", "maintenance" , "hibernation" 
	// action : one of "enable" , "disable" , "suspend"

	// 
	// Optional fields:
	// entity_type : ( entity | regex_entity | regex_ip | subnet )
	// description : a reason for the maintenance.
	// external_id : an external identifier (added to the alert data) e.g. a change control ticket.
	//		 can be used as a key for enabling/disabling maint mode.
	//
	// Timings: 
	// start_time = (default now) 
	// end_time = (default indefinite ) 
	//

	maintModeData=eventOverflow.maintModeData;
	var epochTime=Math.round(Date.now()/1000);

	// Create a maint record, pre-populated with defaults. 

	var maintRecord=new MaintRecord();

	// Check mandatroy fields are present if not then ignore.

	for ( var manIdx = 0 ; manIdx < mandatory_fields.length ; manIdx++ ) {

		if ( !maintModeData[mandatory_fields[manIdx]] ) {

			logger.warning("maintModeAB: Mandatory field '" + mandatory_fields[manIdx] + "' not found - ignoring");
			response.output("Maint. mode event - discarded");
			response.retcode(-1);
    			return;
		}
	}
	
	
	// Mandatory - no defaults. 

	maintRecord.entity=maintModeData.entity;
	maintRecord.maint_mode=maintModeData.maint_mode.toLowerCase();
	maintRecord.status=maintModeData.status.toLowerCase();
	
	// Check these values against lookups. 

	if ( !lookups.maint_mode[maintRecord.maint_mode] ) {
		
		logger.warning("maintModeAB: Mode " + maintRecord.maint_mode + " is not a recognised maintenance mode - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	
	}
	if ( !lookups.status[maintRecord.status] ) {
		
		logger.warning("maintModeAB: Status " + maintRecord.status + " is not a recognised maintenance mode status - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	
	}

	//
	// Optional fields - check and populate with defaults.
	//

	// Times.


	maintRecord.start_time = (typeof maintModeData.start !== 'undefined') ? parseInt(maintModeData.start) : maintRecord.start_time;
	maintRecord.end_time = (typeof maintModeData.end !== 'undefined') ?  parseInt(maintModeData.end) : maintRecord.end_time;
	maintRecord.updated_by = (typeof maintModeData.updated_by !== 'undefined' ) ? maintModeData.updated_by.toLowerCase() : "system";
	

	if ( maintRecord.end_time !== 0 && 
			( maintRecord.end_time < maintRecord.start_time || maintRecord.end_time < epochTime ) 
		) {

		logger.warning("maintModeAB: Timings: end time is before start time or end time is in the past  - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	}


	maintRecord.description = typeof maintModeData.description !== 'undefined' ? maintModeData.description : false;
	maintRecord.external_id = typeof maintModeData.external_id !== 'undefined' ? maintModeData.external_id : false;

	var entity_type;

	// Check the entity_type matches a known type or use the default. 

	if ( typeof maintModeData.entity_type !== 'undefined' && lookups.entity_type[maintModeData.entity_type.toLowerCase()] ) {
		maintRecord.entity_type=maintModeData.entity_type.toLowerCase();
	}

	// Escape any regex backslashes for the mysql insert and comparison. 

	if ( /regex_(ip|entity)/i.test(maintRecord.entity_type) ) {
		logger.warning("REGEX: " + maintRecord.entity);
		maintRecord.entity= maintRecord.entity.replace(/\\/g,"\\\\");
		logger.warning("REGEX: " + maintRecord.entity);
	}

	// 
	// Rules for insertion. 
	//
	// 1. if no start time is given then the current time will be used.
	// 2. if no end time is given then the period will be indefinite (0) 
	// 3. if the end time is before the current time or start time the record will be discarded. 
	// 4. if an external_id is provided - the status will be updated based on this (assuming the entity is the same).
	// 5. if no external_id is provided - then status will be updated based on matches for the start and end time
	// 6. if no external_id or times are provided then only indefinite records for the entity (end time 0) will be updated with the status. 
	// 

	// Retrieve existing records for comparison (are we inserting or updating) 

	var numMatches=0;
	var sqlStatements=[];

	// Build a query based on the entity and entity_type

	var getEntityRecordsQuery="";
	getEntityRecordsQuery += "select * from mm_details where entity = '" + maintRecord.entity + "'";
	getEntityRecordsQuery += "and entity_type = '" + maintRecord.entity_type + "'";

	printMe(getEntityRecordsQuery);

	var entityRecords=maintModeConnection.query(getEntityRecordsQuery);

	// We may be doing multiple updates/inserts if the incoming event is matches multiple existing records. 

	if ( entityRecords && entityRecords.rows() !== 0 ) {

		var entityRow;
		while ( entityRecords.hasNext() === true ) {

			entityRow=entityRecords.next();
			var maintEntry=getMaintEntry(entityRow);

			// See if this entry is one we might want to update. 

			var updateString=compareEntries(maintRecord,maintEntry) ;

			// We need to track if we match - if there are no matches then
			// this is an insert. 

			if ( updateString )  {
				numMatches++;
				sqlStatements.push(updateString);
			}
		}
	}

	if ( !numMatches ) {

		// We didn't find/match any existing records, so treat this an an insert. 
		// We'll do a longhand insert to avoid any column ordering issues. 
		
		logger.info("maintModeAB: Incoming record matched no others, treating as an insert");

		var insertString="insert into mm_details  ( ";
		insertString += "id, entity, entity_type, start_time, end_time, maint_mode, description, external_id, status, updated_by)";
		insertString += " values (0,";
		insertString +=  "'" + maintRecord.entity + "',";
		insertString +=  "'" + maintRecord.entity_type + "',";
		insertString +=   maintRecord.start_time + ",";
		insertString +=   maintRecord.end_time + ",";
		insertString +=  "'" + maintRecord.maint_mode + "',";
		insertString +=  maintRecord.description ? "'" + maintRecord.description + "'," : "'',";
		insertString +=  maintRecord.external_id ? "'" + maintRecord.external_id + "'," : "'',";
		insertString +=  "'" + maintRecord.status + "',";
		insertString += "'" + maintRecord.updated_by + "'";
		insertString += ")";

		sqlStatements.push(insertString);
		
	}

	printMe("-------------------------------------------");
	printMe(" SQL Statements \n\n");
	printMe(sqlStatements);
	printMe("-------------------------------------------");

	// Iterate through the SQL statements and perform them.

	for ( var sqlIdx = 0 ; sqlIdx < sqlStatements.length ; sqlIdx++ ) {

		try {
			var dbSQL=maintModeConnection.execute(sqlStatements[sqlIdx]);
		}
		catch(e) {
			logger.warning("maintModeAB: SQL statement failed " + e );
		}
	}

	// Maintenance mode events will not be needed as alerts. 
	// This may chsnge for auditing purposes.

	// Return with no alert created. 

	response.output("Maint. mode event - discarded");
	response.retcode(-1);
    	return;
}

//
// getMaintEntry : Take a datbase row and construct an object to compare the incoming maintRecord with.
// compareEntries : the heavy lifting logic determining what to do with the entry

function compareEntries(maintRecord, maintEntry) {

	// Compare the fields in the two records.
	// incoming event is assumed to be the most truthful. 
	// we will update these fields.

	var recordId=maintEntry.record_id;
	var updateString="";
	var updates=[];

	var updateFields={
			entity		: false,
			entity_type	: false,
			maint_mode	: false,
			status		: false,
			start_time	: false,
			end_time	: false,
			description	: false,
			external_id	: false,
			updated_by	: false
	};

	//
	// Now use the rules to determine what we fields we should update. 
	//
	// 1. if an external_id is provided - the status will be updated based on this (assuming the entity is the same).
	// 2. if no external_id is provided - then status will be updated based on matches for the start and end time
	// 3. if no external_id or times are provided then only indefinite (end time 0 ) records for the entity wil be updated with the status. 
	// 

	// We are assuming external_id will be unique to a record, if not then this logic will change all
	// probably undesirable. 
	
	if ( maintRecord.external_id && ( maintRecord.external_id === maintEntry.external_id ) ) {

		// the external id is the same
		// update the record with the new data if it is not the same. 

		logger.info("maintModeAB: compareEntries :  Record and Entry matches external_id - updating");

		updateFields.start_time=( maintRecord.start_time !== maintEntry.start_time ) ? maintRecord.start_time : false;
		updateFields.end_time=( maintRecord.end_time !== maintEntry.end_time ) ? maintRecord.end_time : false;
		updateFields.status=( maintRecord.status !== maintEntry.status ) ? maintRecord.status : false;
		updateFields.maint_mode=( maintRecord.maint_mode !== maintEntry.maint_mode ) ? maintRecord.maint_mode : false;
		updateFields.description=( maintRecord.description !== maintEntry.description ) ? maintRecord.description : false;
		updateFields.updated_by=( maintRecord.updated_by !== maintEntry.updated_by ) ? maintRecord.updated_by : false;
	}
	else if ( ( maintRecord.start_time === maintEntry.start_time ) && ( maintRecord.end_time === maintEntry.end_time ) ) {
	
		// No external id or not matching so look for macthing start and end times as a key. 
		// We only care about maint_mode, status and description. 

		logger.info("maintModeAB: compareEntries : Record and Entry matches timings - updating");

		updateFields.status=( maintRecord.status !== maintEntry.status ) ? maintRecord.status : false;
		updateFields.maint_mode=( maintRecord.maint_mode !== maintEntry.maint_mode ) ? maintRecord.maint_mode : false;
		updateFields.description=( maintRecord.description !== maintEntry.description ) ? maintRecord.description : false;
		updateFields.updated_by=( maintRecord.updated_by !== maintEntry.updated_by ) ? maintRecord.updated_by : false;
	}
	else if ( maintRecord.end_time === 0 && maintEntry.end_time === 0 ) {
	
		// No external_id or matching time - so look for indefinite (end time 0) and update those only. 
		// But only for non-operator triggered periods (i.e. not from the operator tooling)

		logger.info("maintModeAB: compareEntries : Record and Entry matches entity only - updating indefinite entries only");

		updateFields.start_time=( maintRecord.start_time !== maintEntry.start_time ) ? maintRecord.start_time : false;
		updateFields.status=( maintRecord.status !== maintEntry.status ) ? maintRecord.status : false;
		updateFields.maint_mode=( maintRecord.maint_mode !== maintEntry.maint_mode ) ? maintRecord.maint_mode : false;
		updateFields.description=( maintRecord.description !== maintEntry.description ) ? maintRecord.description : false;
		updateFields.external_id=( maintRecord.external_id !== maintEntry.external_id ) ? maintRecord.external_id : false;
		updateFields.updated_by=( maintRecord.updated_by !== maintEntry.updated_by ) ? maintRecord.updated_by : false;
	}
	else {
		// No match for this record, return nothing.
		// If no match is ever found this will be treated as an insert. 

		return(updateString);
	}
			
	// Compose the update string.
		

	for ( var attr in updateFields ) {

		if ( updateFields[attr] !== false ) {

			// Add the correct update syntqx based on type. 
			// These should reflect the columns types (text|varhar or int) 
			// in the database

			var myType = typeof(attr);

			switch(myType) {

				case "function" : break;

				case "number"	: updateString =  attr + " = " + updateFields[attr];
				  		  updates.push(updateString);
				  		  break;

				case "string"	: updateString =  attr + " = '" + updateFields[attr] + "'";
				  		  updates.push(updateString);
				  		  break;

				default		: updateString =  attr + " = '" + updateFields[attr] + "'";
				  		  updates.push(updateString);
				  		  break;
			}
		}
	}

	// Create a the SQL string we are going to send. 

	if ( updates.length > 0 ) {
		updateString="update mm_details set " + updates.join(",") + " where id = " + recordId;
	}

	return(updateString);
		
}

function getMaintEntry(maintEntry) {

	var entry={};

	entry.record_id=maintEntry.value("id") ;
	entry.entity=maintEntry.value("entity") || "";
	entry.entity_type=maintEntry.value("entity_type") || "entity";
	entry.maint_mode=maintEntry.value("maint_mode") || "";
	entry.status=maintEntry.value("status") || "";
	entry.start_time=parseInt(maintEntry.value("start_time")) || 0;
	entry.end_time=parseInt(maintEntry.value("end_time")) || 0;
	entry.description=maintEntry.value("description") || "";
	entry.external_id=maintEntry.value("external_id") || "";

	return(entry);
}


//
// Utiliity functions:
// printMe : debug tool to iteratively logger an object. 
// isArray : return true if the passed object is an array. 
//

function printMe(m,i) {

	// Recursive log print.

	var indent;
	var indentString="";

	if (arguments.length === 2 ) {
	indent=arguments[1];
	}
	else {
		indent=-1;
 	}
	indent++;

	for ( var tabc = 0 ; tabc <= indent ; tabc++ ) {
		indentString += "-";
	}

	indentString +="> ";

	if ( typeof m === 'string' || typeof m  === 'number' || typeof m === 'boolean') {
		logger.info("PrintMe: " + indentString + m );
	}

	if ( typeof m === 'object' ) {
		for ( var attr in m ) {
			var atType=typeof m[attr];
			switch(atType) {
				case 'string':  logger.warning("PrintMe: " + indentString + attr + " : " + m[attr]); break;
				case 'number':  logger.warning("PrintMe: " + indentString + attr + " : " + m[attr]); break;
				case 'boolean':  logger.warning("PrintMe: " + indentString + attr + " : " + m[attr]); break;
				case 'object':  logger.warning("PrintMe: " + indentString + " Obj: "+ attr) ;
						indent++;
						printMe(m[attr],indent);
						break;
				default: break;
			}
		}
	}
}

function isArray(o) {
  return Object.prototype.toString.call(o) === '[object Array]'; 
}
