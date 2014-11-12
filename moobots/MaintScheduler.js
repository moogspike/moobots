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
 * v1.0
 ************************************************************/

var scheduler   =MooBot.loadModule('Scheduler');
var logger      =MooBot.loadModule('Logger');
var moogdb      =MooBot.loadModule('MoogDb');
var REST	=MooBot.loadModule('REST');
var externalDb  = MooBot.loadModule('ExternalDb');

// var constants   =MooBot.loadModule('Constants');
// Custom lookup contstant for Graze use
// This will work across moobots, so care should be taken
// not to remove unless necessary. 

var grazeLookup =MooBot.loadModule('Constants');

// Configurable global variables for Graze

var grazeUsername="graze";
var grazePassword="graze";
var grazeServer="https://moogdev:8080";
var grazeBasePath="/graze/v1/";
var grazeURL=grazeServer + grazeBasePath;

// We can just call the getGRazeToken to ensure we don't interfere 
// with any existing constant. 

var grazeToken=getGrazeLoginToken();

//
// Scheduled Jobs
//

scheduler.scheduleJob(this, "updateMaintMode",30,30);

//
// Scheduled Functions 
//

function updateMaintMode() {

	//
	// Scheduled function to update maintenance mode data on 
	// existing alerts. 
	//

	
	// Establish a connection to the maint mode database. 
        // Config held in the global db config file.

	logger.warning("maintMode-sched: Starting");

        var maintModeConnection=externalDb.connect("maintMode");
	
	if ( !maintModeConnection )  {
                logger.warning("maintMode-sched: Unable to establish a connection to maint mode database ");
                return;
        }

	// Get the alert field(s) we are using to hold the entity under maintenance - NOT a custom info field.
	// We'll default to "source" if we can't find one.	
	// alertField - the alert attributre to examine for entity, regex_entity and regex_ip defined maint periods. 
	// subnetAlertField - the alert attribute to examine for subnet defined maint periods. 

	var default_alertField = "source";
	var alertFieldConfig=getMaintConfig(maintModeConnection);
	
	var alertField=alertFieldConfig.alertField ? alertFieldConfig.alertField : default_alertField ;
	var subnetAlertField=alertFieldConfig.subnetAlertField ? alertFieldConfig.subnetAlertField : alertField; 

	logger.info("maintMode-sched: Using '" + alertField + "' as the alert attribute to match entities to.");
	logger.info("maintMode-sched: Using '" + subnetAlertField + "' as the alert attribute to match IP Subnet entities to.");

	// Aged out expired periods
	
	expireAgedPeriods(maintModeConnection) ;

	// Retrieve a list of perdiods from the maint mode database. 

	var allPeriods=getPeriods(maintModeConnection);

	// Get a set of alert data for each period - only periods with alerts will be 
	// considered for updating. 

	var updatePeriods=getPeriodAlerts(allPeriods,alertField,subnetAlertField);

	// We now have a set of periods, and the alerts that they affect. 
	// We want to update the customInfo for each, but really only want to do this once per alert if 
	// it covered by multiple periods. 

	var alertCustomInfo=getAlertCustomInfo(updatePeriods);

	// We should now have alertCustomInfo populated with alertIds and the current maintenance state.
	// Iternate through this and update the alert customInfo using Graze. 
	// [ currently the only method supported for the scheduler ] 

	var affectedSigs=updateAlerts(alertCustomInfo);

	// 
	// We now need to tag all situations that have maint entity alerts in them.
	// we have a list of situations that have been affected by maint periods
	// some will be down to maint mode being enabled for the contained alerts
	// some will be down to maint mode being disabled for the contained alerts
	// 
	// Resolve the conflict - if any alert is in maint mode, the the sit is.
	// If the active and inactive contain the same situation - e.g. when one alert
	// has an expired period an one becomes active - then still update the situation

	// List all inactive sigs that are not in the active list. 

	var inactiveSigs=affectedSigs.inactive.filter(function(a) { return affectedSigs.active.indexOf(a) < 0 ;});
	var activeSigs=affectedSigs.active;

	logger.info("maintMode-sched: Found " + activeSigs.length + " situations to put into maint mode");
	logger.info("maintMode-sched: Found " + inactiveSigs.length + " situations to remove from maint mode");

	// Update the sigs accordingly passing the sig list and the status.
	
	updateSigs(activeSigs,"enabled");
	updateSigs(inactiveSigs,"disabled");

	// Finally mark all expired periods as finished

	try { maintModeConnection.execute("update mm_details set status='finished' where status='expired'"); }
	catch(e) { logger.warning("maintMode-sched: Failed to set expired periods as finished : " +e ); }

	logger.warning("maintMode-sched: Ending");

}

//
// --------------------------------------------------------------------------------------------------
// Function definitions:
// --------------------------------------------------------------------------------------------------
//
// maintMode functions:
//
// getPeriods - retrieve a list of periods from the database, passed the connection and field names
// expireAged Periods - any period past it's end_time is considered expired 
// getMaintConfig - retrieve the alert and subnet slots to query against. 
// getPeriodAlerts - get the alerts for each period - and mrk these periods for update. 
// getAlertCustomInfo - get the custominfo for each alert in each period and determine if it needs to be updated. 
// updateAlerts - update the alerts custom info as needed, extract the affected situations. 
// updateSigs - update the situation description and customInfo as needed
//
// Utility functions:
//
// isArray - is the object an array ? 
// convertEpochToDate - convert an epoch seconds to a readable date.
// getMaintEntry - take a returned database row and convert to a usable js object
// getGrazeLoginToken - retreive a Graze auth toekn and store it in a constant
// setGraze - wrapper for any Graze set endpoint (setGraze(<endpoint>,{params});
// getGraze - wrapper for any Graze get endpoint (getGraze(<endpoint>,{params});
// printMe - Geenric deep object logger 
// isEqual + associated helpers - deep object equalit ( isEqual(a,b) wil return true if a = b regardless of type depth etc.) 
// isInSubnet - pass an IP and a CIDR subnet, returns true if the address is in the subnet.
// getSubnetData - pass a CIDR format subnet (or IP address with mask - 10.0.0.1/24) and get the subnet, first/last address 
//		   and subnet mask back as an object. 
//


function getPeriods(maintModeConnection) { 

	// Retreive a list of the current maintenance periods - this will be based on time
	// where mm_details < current time and end_time > current time or 0.

	var getMaintPeriodQuery="";
	getMaintPeriodQuery += " select * from mm_details where ";
	getMaintPeriodQuery += " ( start_time <= unix_timestamp(now()) and ( end_time > unix_timestamp(now()) or end_time = 0)) ";
	getMaintPeriodQuery += " or status = 'expired'";
	
	var maintPeriods=maintModeConnection.query(getMaintPeriodQuery);

	// Iterate through the query returns 

	var activePeriods=[];
	var inactivePeriods=[];
	var expiredPeriods=[];
	var allPeriods=[];

        if ( maintPeriods && maintPeriods.rows() !== 0 ) {

		var maintPeriodRow;
		var maintPeriod;

		while ( maintPeriods.hasNext() === true ) {

			maintPeriodRow=maintPeriods.next();
			maintPeriod=getMaintEntry(maintPeriodRow);
	
			if ( maintPeriod.status ) {

				switch (maintPeriod.status) {
					case "enabled" 	: activePeriods.push(maintPeriod); break;
					case "disabled"	: inactivePeriods.push(maintPeriod); break;
					case "expired"	: expiredPeriods.push(maintPeriod); break;
					default 	: break;
				}
			}
		}
	}

	//
	// Process the periods in the context of the current alerts. 
	// 

	logger.info("maintMode-sched: Found " + activePeriods.length + " enabled maintenance periods");
	logger.info("maintMode-sched: Found " + inactivePeriods.length + " disabled maintenance periods");
	logger.info("maintMode-sched: Found " + expiredPeriods.length + " expired maintenance periods");

	// We want to update all records, so examine all periods regardless of state. 
	// Allows an operator to see current and future schedules. 

	allPeriods=activePeriods.concat(inactivePeriods,expiredPeriods);

	return allPeriods;

}


function expireAgedPeriods(maintModeConnection) {

	// We want to expire any aged periods, these will be used to un-tag any alerts / situations that have expired. 
	// These will be picked up in the query to get all required period. 
	// At the end of this function, these expired records will be marked "finished" so we can ignore them in future
	// Any update to a record will refresh the status as needed (from delete to enabled/disabled etc.)
	
	// Criteria  
	// end_time > 0 (ie a defined end time ) that is less than the current time
	// end_time = 0 (indefinite) and status = disabled - housekeeping. 

	try { 
		var ageOutUpdate="";
		ageOutUpdate+= " update mm_details set status = 'expired' where status != 'finished' ";
		ageOutUpdate+= " and ( end_time > 0 and end_time <= unix_timestamp(now()) ) or "; 
		ageOutUpdate+= "( end_time = 0 and status = 'disabled' ) ";
		maintModeConnection.execute(ageOutUpdate);
	}
	catch(e) { 
		logger.warning("maintMode-sched: Failed to update expired periods : " + e); 
		return false;
	}
	return true;

}


function getMaintConfig(maintModeConnection) {

	//
	// Get the alert field(s) we are using to hold the entity under maintenance - NOT a custom info field.
	//

	var slotConfig={};

	var maintModeField=maintModeConnection.query("select alert_slot from mm_config");

	if ( maintModeField && maintModeField.rows() !== 0 ) {
		try {
			slotConfig.alertField=maintModeField.last().value("alert_slot");
		}
		catch(e) { 
			logger.warning("maintMode-sched: Failed to retrieve alert slot from mm_config : " + e);
		}
	}
	else {
		logger.warning("maintMode-sched: Unable to determine alert slot to query - will use default ");
	}

	// See if we have a specfiic slot for IP data to match subnets against 

	var maintModeIpField=maintModeConnection.query("select ip_slot from mm_config");

	if ( maintModeIpField && maintModeIpField.rows() !== 0 ) {
		try {
			slotConfig.subnetAlertField=maintModeIpField.last().value("ip_slot");
		}
		catch(e) { 
			logger.warning("maintMode-sched: Failed to retrieve ip_slot from mm_config will use the alert field " );
		}
	}
	else {
		logger.warning("maintMode-sched: Unable to determine subnet alert slot to query - will use the alert fieldj");
	}

	return slotConfig; 
}


function getPeriodAlerts(allPeriods,alertField,subnetAlertField) {

	// Iterate through the periods and find alerts which match the entity / entity_type matches. 
	
	var updatePeriods=[];
	var thisPeriod;

	for ( var periodIdx = 0; periodIdx < allPeriods.length ; periodIdx++ ) {

		thisPeriod=allPeriods[periodIdx];

		// Based on the entity_type construct the required SQL query. 
		
		var getAlertQuery="";

		if ( thisPeriod.entity_type === 'subnet' ) {
			
			// Get the subnet data - first, last addres etc.
			// so we can construct the net_aton based query. 

			var subnetData=getSubnetData(thisPeriod.entity);

			if ( subnetData ) {
				printMe(subnetData);

				// Using MySQLs inet_aton to convert the alert fields with IP addresses to an int.
				// and then seeing if this is between the lower and upper converted ints for the
				// subnet. 

				getAlertQuery += " select group_concat(alert_id) as alert_ids from alerts where state < 8 and ";
				getAlertQuery += " inet_aton(" + subnetAlertField + ") between  inet_aton('" + subnetData.firstAddress + "') and ";
				getAlertQuery += " inet_aton('" + subnetData.lastAddress + "')";
			}
			else {

				logger.warning("maintMode-sched: Could not retrieve subnet data for entity " + thisPeriod.entity);
			}
		}
		else { 

			// Use the regexp or = qualifier as needed for the entity type
			// Only get open/active alerts. 

			getAlertQuery +="select group_concat(alert_id) as alert_ids from alerts where state < 8 and " + alertField ;
			getAlertQuery += /regex_(ip|entity)/.test(thisPeriod.entity_type) ? " regexp " : " = ";
			getAlertQuery += "'" + thisPeriod.entity + "'";
		}

		// We will get a list back (comma separated) of all the alerts that match the query
		// store this as a string to be used later for updates. 

		
		if ( getAlertQuery ) {

			var alertResults=moogdb.query(getAlertQuery);
			var alertRow;
			var alert_ids;

			if ( alertResults && alertResults.rows() === 1  ) {
				alertRow=alertResults.last();
		 		try { 
					alert_ids=alertRow.value("alert_ids"); 
					if ( alert_ids ) {

						// Add the list of alerts to the period
						// and this period to the list of periods to update data for.

						thisPeriod.alerts=alertRow.value("alert_ids").split(",");
						updatePeriods.push(thisPeriod);
					}
				}
				catch(e) {
					logger.warning("maintMode-sched: Unable to get a list of alert ids for record " + thisPeriod.record_id);
				}
			}
		}
	}
	return updatePeriods;

}

function getAlertCustomInfo(updatePeriods) {

	// Retreive all of the customInfo for the alerts - we are only going to replace
	// the custom_info.maintenance_data eventually. 

	var alertCustomInfo={};
	var thisPeriod;

	periods:
	for ( var period in updatePeriods ) {

		if ( typeof period === 'function' ) {
			continue periods;
		}
			
		thisPeriod=updatePeriods[period];
		var alerts=thisPeriod.alerts || [];

		logger.info("maintMode-sched: Updating alerts affected by period id  " + thisPeriod.record_id);

		for ( var alertIdx = 0 ; alertIdx < alerts.length ; alertIdx++ ) {

			var alertId = alerts[alertIdx];

			// We have to get the alert itself and then the custom info.

			// We are going to store all of the maint entreis for an alert
			// and just do a single update. 
		
			if ( !alertCustomInfo[alertId] ) {

				alertCustomInfo[alertId]={
						alert_id :alertId,
						maint_status : "",
						Maintenance_Data: {} 
				};

			}

			// We only ever want to update the Maintenance_Data branch
			// setCustomInfo will merge this in

			// A mre readable name. 

			var maintEntry="MaintRecordId-" + thisPeriod.record_id;

			// If the status is enabled, then set the master flag for this alert.
			
			if ( !alertCustomInfo[alertId].maint_status && thisPeriod.status === 'enabled' ) {
					alertCustomInfo[alertId].maint_status="M";
			}

			if ( !alertCustomInfo[alertId].Maintenance_Data[thisPeriod.status] ) {
				alertCustomInfo[alertId].Maintenance_Data[thisPeriod.status]={};
			}
	
			alertCustomInfo[alertId].Maintenance_Data[thisPeriod.status][maintEntry]={
					"Maint. Record" : thisPeriod.record_id,
					"Start time" 	: convertEpochToDate(thisPeriod.start_time),
					"End time"   	: thisPeriod.end_time ? convertEpochToDate(thisPeriod.end_time) : "Indefinite",
					"Entity"	: thisPeriod.entity,
					"Description" 	: thisPeriod.description,
					"Identifier"	: thisPeriod.external_id,
					"Type"		: thisPeriod.maint_mode,
					"Status"	: thisPeriod.status,
					"Last Updated"	: thisPeriod.last_updated,
					"Updated by"	: thisPeriod.updated_by
			};
		}
					
	}
	return alertCustomInfo;
}


function updateAlerts(alertCustomInfo) {

	// We should now have alertCustomInfo populated with alertIds and the current maintenance state.
	// Iternate through this and update the alert customInfo using Graze. 
	// [ currently the only method supported for the scheduler ] 

	// We are also going to extract the situations we need to update
	// from the alerts we are updating. 

	var affectedSigs={
				active : [],
				inactive : []
	};

	var numProcessedAlerts=0;

	for ( var alertCI in alertCustomInfo ) {

		if ( typeof alertCI !== 'function' ) {
			
			// Auth_token will be added during the setGraze()
			// Maintenance_Status set to 1 (in maintenance) 

			var myAlertId=parseInt(alertCustomInfo[alertCI].alert_id);
			var myAlertMaintStatus=alertCustomInfo[alertCI].maint_status;
		
			// Create the custom_info sub tree for update.

			var setCustomInfoParams = {
						alert_id : myAlertId,
						custom_info: { 
								Maintenance_Status : myAlertMaintStatus,
								Maintenance_Data : alertCustomInfo[alertCI].Maintenance_Data 
						}
			};

			// Before the updte we want to remove the existing data otherwise it will be merged
			// and we will end up with mixed new and old records. 
			// Set then maint_data to null to do this. 
	
			var blankCustomInfoParams = {
						alert_id : myAlertId,
						custom_info: { 
								Maintenance_Status : myAlertMaintStatus,
								Maintenance_Data : null
						}
			};


			// Decide if we need to update this alert based only on changes to the alert.
			// Also get the active sig_list for this alert - used to update the situation desciption.
			
			var myAlert=moogdb.getAlert(myAlertId);

			if ( myAlert) {

				numProcessedAlerts++;

				var updateCustomInfo=false;

				// Get the sig list and custom info
				// remember to parse sig_list using toString and JSON parse.

				var existingCustomInfo={};
				var active_sig_list;
				var active_sig_string;
				var active_sig_array=[];

				try { 
					existingCustomInfo=myAlert.getCustomInfo(this);
					active_sig_list=myAlert.value("active_sig_list"); 

					// Add the active sigs to the activeSig array for updating
					// after all the alert updates. 

					if ( active_sig_list ) {
						active_sig_string=active_sig_list.toString(); 
						active_sig_array=JSON.parse(active_sig_string);

						for ( var s = 0; s < active_sig_array.length ; s ++ ) {

							// We want to update the sig with the correct 
							// active or inactive. So push to the correct 
							// status. 

							if ( myAlertMaintStatus === "M" && affectedSigs.active.indexOf(active_sig_array[s]) === -1 ) {

								// alert in maint mode, push sig to active.
								affectedSigs.active.push(active_sig_array[s]);
							}
							else {
								// alert not in maint mode, push to inactive. 

								if ( affectedSigs.inactive.indexOf(active_sig_array[s]) === -1 ) {
			
									affectedSigs.inactive.push(active_sig_array[s]);
								}
							}
						}
					}
				}
				catch(e) {
					logger.warning("maintMode-sched: Error retrieving current data from alert id: " + myAlertId + " : " +e);
				}

				// Compare the new maint data and the existing custominfo. 

				if ( !existingCustomInfo.Maintenance_Data  )  {
					updateCustomInfo=true;
					logger.info("maintMode-sched: Could not fnd any current maintenance data for alert: " + myAlertId);
				}
				else {

					// Check to see if the existing custom inof has the same entries 
					// as the new custom info. 
					// Do an attribute level check for matching entries. 
				
					var existingCIMD=existingCustomInfo.Maintenance_Data;
					var newCIMD=alertCustomInfo[alertCI].Maintenance_Data;

					// Do a deep comparison old to new and new to old. 
					// new always wins if there is a difference. 

					if ( !isEqual(existingCIMD,newCIMD) ) {
						logger.info("maintMode-sched: Record has changed, updating custom info");
						updateCustomInfo=true;
					}
					else {
						logger.info("maintMode-sched: Record is equal - no update required");
					}

				}
					
				if ( updateCustomInfo ) {
				
					// We actually want to do this twice to ensure that the merging is not going to 
					// leave aged records.

					var myBlankCustomInfo=setGraze("addAlertCustomInfo",blankCustomInfoParams);
					var mySetCustomInfo=setGraze("addAlertCustomInfo",setCustomInfoParams);

					if ( mySetCustomInfo ) {
						logger.info("maintMode-sched: Maintenance data updated for alert : "  + myAlertId);
					}
				}
			}
			else {
				logger.warning("maintMode-sched: Unable to retreive alert for alertId " + myAlertId);

			}

		}
	}

	logger.warning("maintMode-sched: Processed " + numProcessedAlerts + " alerts");

	return affectedSigs;
}



function updateSigs(sigList,status) {

	// Get each situation - see if there is a custom info and description set accordingly. 
	// We'll use Graze endpoints to the updates if needed. 
	

	if ( !isArray(sigList) || ( status !== "enabled" && status !== "disabled" ) ) {
		return;
	}

	var sigMaintMsg="[ Entities under maintenance ]";
	var customInfoMaintMsg= ( status === "enabled" ) ? "M" : "";
	
	for ( var sigIdx = 0 ; sigIdx < sigList.length ; sigIdx++ ) {

		var sig_descr;
		var sig_customInfo;
		var sig_id=sigList[sigIdx];
		var newSigDescr;
	
	
		// Get the current sig and the data we are about. 

		var mySig=moogdb.getSituation(sig_id);
		if ( mySig ) {

			sig_descr=mySig.value("description");
			sig_customInfo=mySig.getCustomInfo(this);

			if ( !sig_customInfo ) {
				sig_customInfo={};
			}

		}

		//
		// Does the sig have a suitable description ? 
		// This will be re-added even if altered by the UI.
		//

		//var sigHasMaintDescr=/sigMaintMsg/i.test(sig_descr);

		var sigHasMaintDescr= ( sig_descr.indexOf(sigMaintMsg) > 0 ) ? true : false ;

		var updateSigDescr=false;
		var updateSigCustomInfo=false;

		// If it has the maint message suffix  and we are disabling then remove and update.

		if ( sigHasMaintDescr && status === "disabled" )  {
			newSigDescr=sig_descr.replace(sigMaintMsg,"");
			updateSigDescr=true;
		}
		if ( !sigHasMaintDescr && status === "enabled" )  {
			newSigDescr=sig_descr + " " + sigMaintMsg;
			updateSigDescr=true;
		}
				
		if ( updateSigDescr ) {
			
			// We need to update the situation descr.

			var setSigDescrParams={
				sitn_id : sig_id,
				description: newSigDescr
			};

			var setSigDescr=setGraze("setSituationDescription",setSigDescrParams);

			if ( setSigDescr ) {
				logger.info("maintMode-sched: Set situaiton description to " + newSigDescr + " for situation " + sig_id);
			}
			else {
				logger.warning("maintMode-sched: Failed to set situaiton description to " + newSigDescr + " for situation " + sig_id);
			}
		}
		
		// 
		// Add a custominfo tag to allow UI column display
		// 

		var sig_customParams={
				sitn_id : sig_id,
				custom_info : { 
						Maintenance_Status : customInfoMaintMsg
				}
		};
		
		// Do we have a flag in custom info already, if so is it the same as the new calculated one
	
		if ( typeof sig_customInfo.Maintenance_Status === 'undefined' ||  ( sig_customInfo.Maintenance_Status !== customInfoMaintMsg ) ) { 
			updateSigCustomInfo=true;
		}

		if ( updateSigCustomInfo ) {
		
			var setSigCustomInfo=setGraze("addSituationCustomInfo",sig_customParams);
			if ( setSigCustomInfo ) {
				logger.info("maintMode-sched: Set situation custom info");
			}
			else {
				logger.warning("maintMode-sched: Failed to set situation custom info");
			}
		}
	}
}

function isArray(o) {
  return Object.prototype.toString.call(o) === '[object Array]'; 
}

function convertEpochToDate(epoch) {

	var currentDate=new Date(0);
	currentDate.setUTCSeconds(epoch);
	return(currentDate.toString());
}


function getMaintEntry(maintEntry) {

        var entry={};

        try {
		entry.record_id=maintEntry.value("id") ;
        	entry.entity=maintEntry.value("entity") || "";
        	entry.entity_type=maintEntry.value("entity_type") || "entity";
        	entry.maint_mode=maintEntry.value("maint_mode") || "";
        	entry.status=maintEntry.value("status") || "";
        	entry.start_time=parseInt(maintEntry.value("start_time")) || 0;
        	entry.end_time=parseInt(maintEntry.value("end_time")) || 0;
        	entry.description=maintEntry.value("description") || "";
        	entry.external_id=maintEntry.value("external_id") || "";
        	entry.last_updated=maintEntry.value("last_updated") || "";
        	entry.updated_by=maintEntry.value("updated_by") || "";
	}	
	catch(e) {
		logger.warning("getMaintEntry: Failed to retreive values from a db row :" + e);
		return({});
	}
        return(entry);
}

			
// Retrieve a Graze login token, and store it in 

function getGrazeLoginToken() {
	
	// If we've already got a token, return it.

	var currentStatus=grazeLookup.get("auth_status");
	var currentToken=grazeLookup.get("auth_token");
	if( currentStatus && currentStatus === "current" && currentToken ) {
		logger.info("getGrazeLoginToken: Returning existing token");
		return({auth_token: currentToken }) ;
	}
	else {
		logger.info("getGrazeLoginToken: Requesting login token");
	}
		

	// Retrieve a login token.
	
	var grazeAuthPath="authenticate";
	var getUrl=grazeURL + grazeAuthPath;

	var params={
		username: grazeUsername,
		password: grazePassword
        };
        var encodedParams=REST.getUrlEncodedTextFromParams(params);
        var grazeLoginData=REST.getJson(this,getUrl,encodedParams,"","",true);
	

	if ( grazeLoginData ) {

		if ( grazeLoginData.success && grazeLoginData.response && grazeLoginData.response.auth_token ) {
			
			// We got an auth token back.
			// add to / replace constant. 
			
			logger.warning("Graze: auth token recevied : " + grazeLoginData.response.auth_token);
			grazeLookup.put("auth_token",grazeLoginData.response.auth_token);
			grazeLookup.put("auth_status","current");
			return({"auth_token": grazeLoginData.response.auth_token});

		}
		else {
			logger.warning("getGrazeLoginToken : Failed to get a valid login response from Graze http status: " + grazeLoginData.status_code);
			return({ "error": "Failed to get a valid login response from Graze http status: " + grazeLoginData.status_code});
		}
	
	}
	else {
		logger.warning("getGrazeLoginToken : Failed to get a response from Graze");
		return({error: "Failed to get a reponse from Graze"});
	}
}

	

function getGraze(grazeEndpoint,grazeParams,retryNum) {

	// Retreive the data for a specified Graze endpoint
	// and return it as an object.

	// Get a graze login token try the one in the
	// grazeLookup constant, if that doesn't exist or 
	// gives a 401 then get a new one. 

	var getUrl=grazeURL + "/" + grazeEndpoint;

	var auth_token;
	var grazeReturn={};
	var max_auth_retries = 3;
	logger.warning("GRAZE: Requesting services t");

	// Get a login token either stored or new. 

	var auth_request=getGrazeLoginToken();
	if ( auth_request && auth_request.auth_token ) {
		auth_token=auth_request.auth_token;
	}
	else {
		logger.warning("getGraze: Could not retrieve an auth token");
		return(grazeReturn);
	}

	// Try the request. 

	grazeParams.auth_token=auth_token;
        var encodedParams=REST.getUrlEncodedTextFromParams(grazeParams);
        var grazeData=REST.getJson(this,getUrl,encodedParams,"","",true);

	if ( grazeData ) {
		
		// Check the status code - for a 401 retry the auth, up to max_auth_retries. 

		if ( grazeData.status_code !== 200 ) {

			if ( grazeData.status_code === 401 ) {
		
				// We got an unauthorised - try and get a new login token and 
				// retry. .

				// Force a token refresh on next call to getGrazeLoginToken across
				// any thread. 

				grazeLookup.put("auth_token","");
				grazeLookup.put("auth_status","noAuth");

				// Should we try again, or have we tried enough. 

				retryNum=!retryNum ? 1 : retryNum++;

				if ( retryNum >= max_auth_retries ) {
					logger.warning("getGraze: Authentication failed, max retries exceeded");
					return(grazeReturn);
				}
				retryNum++;
				getGraze(grazeEndpoint,grazeParams,retryNum);

			}
			else {
				logger.warning("getGraze: Endpoint " + grazeEndpoint + " returned an error " + grazeData.status_code);
				return(grazeReturn);
			}
		}
		else if ( grazeData.success && grazeData.response ) {

			// we got a reponse back. Return the entire object. 
			grazeReturn=grazeData.response;
			return(grazeReturn);
			
		}
		else {
			logger.warning("getGraze: Unexpected response from Graze - status 200 but no reponse returned.  ");
		}

	}
	else {
		logger.warning("getGraze: No data returned from endpoint " + grazeEndpoint + " using params " + encodedParams);
		return(grazeReturn);
	}

}


function setGraze(grazeEndpoint,grazeParams,retryNum) {

	// Send data to the specified Graze endpoint.
	// and return true or false based on the return.

	// Get a graze login token try the one in the
	// grazeLookup constant, if that doesn't exist or 
	// gives a 401 then get a new one. 

	var setUrl=grazeURL + "/" + grazeEndpoint;

	var auth_token;
	var max_auth_retries = 3;

	// Get a login token either stored or new. 

	var auth_request=getGrazeLoginToken();
	if ( auth_request && auth_request.auth_token ) {
		auth_token=auth_request.auth_token;
	}
	else {
		logger.warning("setGraze: Could not retrieve an auth token");
		return(false);
	}

	// Try the request. 

	grazeParams.auth_token=auth_token;

	var encodedParams;

	try {
		encodedParams=JSON.stringify(grazeParams);
	}
	catch (e)  {
		logger.warning("setGraze: Failed to encode request body: " + e );
		return(false);
	}

        var grazeData=REST.post(setUrl,encodedParams,"","",true);

	if ( grazeData ) {
		
		// Check the status code - for a 401 retry the auth, up to max_auth_retries. 

		if ( grazeData !== 200 ) {
	
			if ( grazeData === 401 ) {
		
				// We got an unauthorised - try and get a new login token and 
				// retry. .

				// Force a token refresh on next call to getGrazeLoginToken across
				// any thread. 

				grazeLookup.put("auth_token","");
				grazeLookup.put("auth_status","noAuth");

				// Should we try again, or have we tried enough. 

				retryNum=!retryNum ? 1 : retryNum++;

				if ( retryNum >= max_auth_retries ) {
					logger.warning("setGraze: Authentication failed, max retries exceeded");
					return(true);
				}
				retryNum++;
				setGraze(grazeEndpoint,grazeParams,retryNum);

			}
			else {
				logger.warning("setGraze: Endpoint " + grazeEndpoint + " returned an error " + grazeData);
				return(false);
			}
		}
		else {
			// We got a 200 - don't really care about any reponse. 
			return(true);
			
		}

	}
	else {
		logger.warning("setGraze: No data returned from endpoint " + grazeEndpoint + " using params " + encodedParams);
		return(false);
	}

}

function printMe(m) {

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

// Object equality functions:
// returns true is passed objects match - recursive for arrays and objects. 

function isEqual(a,b) {

	// Simple equality - will work for strings, numbers and boolean.

	if ( a === b ) {
		return true;
	} 

	// Get the type of object.

	var typeA = typeof a;
	var typeB = typeof b;

	// Different types, cannot be equal. 

	if ( typeA !== typeB ) {
		return false;
	}

	// Do object level comparison. 

	if ( typeA.toLowerCase() === 'object' ) {

		var objA_type=getObjectType(a);
		var objB_type=getObjectType(b);

		if ( objA_type !== objB_type ) {

			return false;
		}

		var returnVal=false;
		switch (objA_type) {

			 case "array" : returnVal=compareArrays(a,b);
				  	break;
			 case "object" : returnVal=compareObjects(a,b);
				   	 break;
			 case "date" : returnVal=compareDates(a,b);
				       break;
			 case "regexp" : returnVal= compareRegex(a,b);
				  	 break;
			 case "function" : returnVal=compareFunction(a,b);
					   break;
			default : returnVal= false;
				   break;
		}
		return returnVal;

			
	}
	return false;

}

function compareFunction(funcA,funcB) {
	// only really string comparison available.
	// Add your own code if it makes sense 
	return funcA.toString() === funcB.toString();
}

function compareRegex(regA,regB) {
	
	// not much we can other than convert to string and see.
	return regA.toString() === regB.toString();
}

function compareDates(dateA,dateB) {
	// If these are Dates then getDate() (number of epoch millseconds) and compare
	return dateA.getTime() === dateB.getTime();
}

function compareArrays(arrayA,arrayB) {

	if ( arrayA.length !== arrayB.length ) {
		
		return false ;
	}

	// See if the values are the same 
	// Ordering will not be checked to avoid recursion hell.

	for ( var i =0 ; i < arrayA.length ; i++ ) {
		if ( !isEqual(arrayA[i],arrayB[i]) ) {
			return false;
		}
	}
	return true;
}

function compareObjects(objA,objB) {

	for ( var o in objA ) {
		if ( objB.hasOwnProperty(o) ) {
			if ( !isEqual(objA[o],objB[o]) ) {
				return false;
			}
		}
		else {
			return false;
		}
	}
	for ( var x in objB ) {
		if ( objA.hasOwnProperty(x) ) {
			if ( !isEqual(objA[x],objB[x]) ) {
				return false;
			}
		}
		else {
			return false;
		}
	}
	return true;
}

function getObjectType(o) {

	// Get the object prototype, grap the type in a regex, and convert to lowercae. 

	return Object.prototype.toString.call(o).match(/^\[object\s(.*)\]/)[1].toLowerCase();

}


function isInSubnet(ipAddress,subnet) {

	// See if the IP address is in the subnet. 
	
	var subnetData=getSubnetData(subnet);

	if ( !subnetData ) {
		return false;
	}

	var ipInt=addressToInt(ipAddress);

	if ( !ipInt ) {
		return false;
	}

	var subnetMaskInt = -1 << ( 32 - subnetData.maskBits );
	var subnetNetInt = addressToInt(subnetData.subnet);
	
	if ( !subnetNetInt ) {
		return false;
	}
	
	// See if the ip bitwise AND to the mask == the subnet Int. 

	if ( parseInt((ipInt & subnetMaskInt)) === parseInt(subnetNetInt) ) {
		return true;
	}
	else {
		return false;
	}
}

function getSubnetData(subnet) {

	var subnetData={};
	var subnetMatchRe=/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/;

	// See if the subnet is valid, if so process. 

	var subnetInfo=subnet.match(subnetMatchRe);
	if ( !subnetInfo || subnetInfo.length < 3 ) {
		return subnetData;
	}

	var subnetAddress=subnetInfo[1];
	var subnetMask=parseInt(subnetInfo[2]);

	// We may have been passed an IP with a CIDR rather than 	
	// a network with a CIDR. Work out the network address from 
	// the IP/net address. 

	var subnetInt=addressToInt(subnetAddress);
	if ( !subnetInt || subnetMask > 32) {
		return false;
	}

	if ( subnetMask > 32 ) { 
		return false;
	}
	var subnetMaskInt = -1<<(32-subnetMask);

	var networkInt=(subnetInt & subnetMaskInt);

	// Get the relevant data. 
	// first address is always net address + 1
	// last is network + 2^(32-maskbits) -1 

	var firstAddressInt=networkInt + 1;
	var lastAddressInt=networkInt + (Math.pow(2,(32-subnetMask))-1);

	var subnetReturn={
				subnet : intToAddress(networkInt),
				firstAddress : intToAddress(firstAddressInt),
				lastAddress : intToAddress(lastAddressInt),
				subnetMask : intToAddress(subnetMaskInt),
				maskBits : subnetMask
	};

	// Ensure we have valid data.

	if ( 	subnetReturn && 
		subnetReturn.subnet && 
		subnetReturn.firstAddress &&
		subnetReturn.lastAddress && 
		subnetReturn.subnetMask && 
		subnetReturn.maskBits ) {

			return subnetReturn;
	}
	else {
		return {};
	}
}

function addressToInt(ipAddress) {

	if ( !validateIpv4(ipAddress) ) {
		return false;
	}

	var ipMatchRe=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
	var octets=ipAddress.match(ipMatchRe);

 	if ( octets && octets.length >= 5 ) {
		// Return a 32 bit number representing the ip address
		// shift the octets leftwise by the required amount. 
        	return  (octets[1]<<24) + (octets[2]<<16) + (octets[3]<<8) + (octets[4]<<0);
	}
	else {
		return false;
	}
}

function intToAddress(ipInt) {

	var val=[ ((ipInt<<0)>>>24),((ipInt<<8)>>>24),((ipInt<<16)>>>24),((ipInt<<24)>>>24)].join("."); 
	return validateIpv4(val) ? val : false;
}

function validateIpv4(ipAddress) {
	return /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(ipAddress) ? true : false;
}

