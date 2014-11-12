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
// Specify our database details. 
//

var dbTypes = {
	maintMode: {
			type: 'mySql',
			host: 'localhost',
			port: '3306',
			database: 'moogmaint',
         		user: 'ermintrude',
         		password: 'm00'
	}
};

//
// Global lookup data.
//

// These fields are the minimum required. 

var mandatory_fields=[ "entity" , "mode" , "status" ];

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
		"mode"	: {
			"maintenance"	: true,
			"blackout"	: true,
			"hinernation"	: true
		},
		"status" : {
			"enabled"	: true,
			"disabled"	: true,
			"suspended"	: true
		}
};
			
		

function newEvent(event,response) 
{
	
	logger.info("MAINTMODE: Start");

	// Establish a connection to the database - best practice is witihn the function
	// not at the top level. 

	var maintModeConnection= externalDb.connect(dbTypes.maintMode);

	if ( !maintModeConnection )  {

		logger.warning("maintModeAB: Unable to extablish a connection to " + dbTypes.maintMode.database);
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
	// type : one of "blackout", "maintenance" , "hibernate" 
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

	var default_startTime=epochTime;
	var default_endTime=0;
	var default_description="";
	var default_externalId="";
	var default_entityType="entity";

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

	var entity=maintModeData.entity;
	var mode=maintModeData.mode.toLowerCase();
	var status=maintModeData.status.toLowerCase();
	
	// Check these values against lookups. 

	if ( !lookups.mode[mode] ) {
		
		logger.warning("maintModeAB: Mode " + mode + " is not a recognised maintenance mode - ignoring";
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	
	}
	if ( !lookups.status[status] ) {
		
		logger.warning("maintModeAB: Status " + status + " is not a recognised maintenance mode status - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	
	}

	//
	// Optional fields - check and populate with defaults.
	//

	// Times.

	var start_time = typeof maintModeData.start !== 'undefined' ? parseInt(maintModeData.start) : default_startTime;
	var end_time = typeof maintModeData.end !== 'undefined' ? parseInt(maintModeData.end) : default_endTime;

	if ( end_time !== 0 && ( end_time < start_time )  {

		logger.warning("maintModeAB: Timings: end time is before start time - ignoring");
		response.output("Maint. mode event - discarded");
		response.retcode(-1);
    		return;
	}


	var description = typeof maintModeData.description !== 'undefined' ? maintModeData.description : default_description;
	var external_id = typeof maintModeData.external_id !== 'undefined' ? maintModeData.external_id : default_externalId;

	var entity_type;

	// Check the entity_type matches a know type or use the default. 

	if ( typeof maintModeData.entity_type !== 'undefined' && lookups.entity_type[maintModeData.entity_type.toLowerCase()] ) {

		entity_type=maintModeData.entity_type.toLowerCase();
	}
	else {
		entity_type=default_entityType;
	}

	var maintRecord=new MaintRecord(

	// 
	// Rules for insertion. 
	//
	// 1. if no start time is given then the current time will be used.
	// 2. if no end time is given then the period will be indefinite (0) 
	// 3. if the end time is before the current time or start time the record will be discarded. 
	// 4. if an external_id is provided - the status will be updated based on this (assuming the entity is the same).
	// 5. if no external_id is provided - then status will be updated based on matches for the start and end time
	// 6. if no external_id or times are provided then all records for the entity wil be updated with the status. 


	
	
	// Construct the SQL insert.
	// We do not really care about multiples for the same entity, these will be harvested on a schedule
	// and the miant mode logic in the core alert builder will manage overlaps. 

	var insertSql="";
	var queryFields=[ entity , entity_type , start_time , end_time , type , description, external_id ];
	var queryString=queryFields.join("','");
	insertSql += "insert into mm_details values (0,'" + queryString + "')";

	logger.warning("maintModeAB: " + insertSql);

	// Attempt the insert. 

	try {
		var dbReturn=maintModeConnection.execute(insertSql);
		if ( !dbReturn ) {
			logger.warning("maintModeAB: Error occurred during maint record insert");
		}
		else {
			logger.info("maintModeAB: Record inserted for entity : " + entity);
		}
	}
	catch(e) {
		logger.warning("maintModeAB: Error occurred during maint record insert " + e);
	}
	
	// Maintenance mode events will not be needed as alerts. 
	// This may chsnge for auditing purposes.

	// Return with no alert created. 

	response.output("Maint. mode event - discarded");
	response.retcode(-1);
    	return;
}
