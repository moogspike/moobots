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

var events      = MooBot.loadModule('Events');
var logger      =MooBot.loadModule('Logger');
var moogdb      =MooBot.loadModule('MoogDb');
var REST	=MooBot.loadModule('REST');
var externalDb  = MooBot.loadModule('ExternalDb');
var constants   = MooBot.loadModule('Constants');

// This is event driven to update maint mode 
// on alert creation.

events.onEvent("checkMaintMode",constants.eventType("Alert")).listen();

//
// checkMaintMode - passed the alert 
// This will check to see what periods the alert falls into
// and then update custom info accordingly. 
// This will NOT update situaitons (it won't be in any yet)
// this will be done by the scheduled function. 
// 
//

function checkMaintMode(alert,response) {

	// Retreive the base information about the alert. 
	
	var alert_id = alert.value("alert_id");
	var existingCustomInfo=alert.getCustomInfo(this);

	if ( !existingCustomInfo ) {
		existingCustomInfo={};
	}

	logger.info("maintMode-inline: Processing alert " + alert_id + " for maint data on creation");
	
	// Establish a connection to the maint mode database. 
        // Config held in the global db config file.

        var maintModeConnection=externalDb.connect("maintMode");
	
	if ( !maintModeConnection )  {
                logger.warning("maintMode-inline: Unable to establish a connection to maint mode database ");
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

	// We will check this alert against the current periods to see if it belongs in one or more. 

	
	// Get a list of the current periods. 

	var allPeriods=getPeriods(maintModeConnection);

	// Extract the current alert values for the specified fields. 

	var alertFieldValue=alert.value(alertField) ? alert.value(alertField) : null;
	var subnetAlertFieldValue=alert.value(subnetAlertField) ? alert.value(subnetAlertField) : null;

	// Get the periods affecting this alert. 
	
	var updatePeriods=[];

	if ( alertFieldValue && subnetAlertFieldValue ) {

		updatePeriods=getPeriodsForAlert(allPeriods,alert_id,alertFieldValue,subnetAlertFieldValue,alertField,subnetAlertField) ;
	}

  	var alertCustomInfo=getAlertCustomInfo(updatePeriods);

	// Do the update to the alert's custom info based on the processed data 
	// this will pass back the alert if it is updated. 

	if ( alertCustomInfo[alert_id] ) {

		// There is a potential  upd	

		var myAlertMaintStatus=alertCustomInfo[alert_id].maint_status;
		var updateCustomInfo=false;

		// Compare the new maint data and the existing custominfo. 

		if ( !existingCustomInfo.Maintenance_Data  )  {
			updateCustomInfo=true;
			logger.info("maintMode-inline: Could not fnd any current maintenance data for alert: " + alert_id);
		}
		else {

			// Check to see if the existing custom info has the same entries 
			// as the new custom info. 
			// Do an attribute level check for matching entries. 
				
			var existingCIMD=existingCustomInfo.Maintenance_Data;
			var newCIMD=alertCustomInfo[alert_id].Maintenance_Data;

			// Do a deep comparison old to new and new to old. 
			// new always wins if there is a difference. 

			if ( !isEqual(existingCIMD,newCIMD) ) {
				logger.info("maintMode-inline: Record has changed, updating custom info");
				updateCustomInfo=true;
			}
			else {
				logger.info("maintMode-inline: Record is equal - no update required");
			}

		}
					
		if ( updateCustomInfo ) {
			
			var newCustomInfo=existingCustomInfo;

			// Add the new custom info data to existing and then update. 
			newCustomInfo.Maintenance_Status = myAlertMaintStatus;
			newCustomInfo.Maintenance_Data = alertCustomInfo[alert_id].Maintenance_Data ;
			logger.info("maintMode-inline: Updating alert " + alert_id + " with maintenance data");
			alert.setCustomInfo(this,newCustomInfo);
			moogdb.setAlertCustomInfo(alert);
		}
	}
	return;
}

	
//
// --------------------------------------------------------------------------------------------------
// Function definitions:
// --------------------------------------------------------------------------------------------------
//
// maintMode functions:
//
// getPeriods - retrieve a list of periods from the database, passed the connection and field names
// getMaintConfig - retrieve the alert and subnet slots to query against. 
// getPeriodAlerts - get the alerts for each period - and mrk these periods for update. 
// getAlertCustomInfo - get the custominfo for each alert in each period and determine if it needs to be updated. 
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

	logger.info("maintMode-inline: Found " + activePeriods.length + " enabled maintenance periods");
	logger.info("maintMode-inline: Found " + inactivePeriods.length + " disabled maintenance periods");
	logger.info("maintMode-inline: Found " + expiredPeriods.length + " expired maintenance periods");

	// We want to update all records, so examine all periods regardless of state. 
	// Allows an operator to see current and future schedules. 

	allPeriods=activePeriods.concat(inactivePeriods,expiredPeriods);

	return allPeriods;

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
			logger.warning("maintMode-inline: Failed to retrieve alert slot from mm_config : " + e);
		}
	}
	else {
		logger.warning("maintMode-inline: Unable to determine alert slot to query - will use default ");
	}

	// See if we have a specfiic slot for IP data to match subnets against 

	var maintModeIpField=maintModeConnection.query("select ip_slot from mm_config");

	if ( maintModeIpField && maintModeIpField.rows() !== 0 ) {
		try {
			slotConfig.subnetAlertField=maintModeIpField.last().value("ip_slot");
		}
		catch(e) { 
			logger.warning("maintMode-inline: Failed to retrieve ip_slot from mm_config will use the alert field " );
		}
	}
	else {
		logger.warning("maintMode-inline: Unable to determine subnet alert slot to query - will use the alert fieldj");
	}

	return slotConfig; 
}

function getPeriodsForAlert(allPeriods,alert_id,alertFieldValue,subnetAlertFieldValue,alertField,subnetAlertField) {

	// Iterate through the periods and find alerts which match the entity / entity_type matches. 
	
	var updatePeriods=[];
	var thisPeriod;

	for ( var periodIdx = 0; periodIdx < allPeriods.length ; periodIdx++ ) {

		thisPeriod=allPeriods[periodIdx];
		thisPeriod.alerts=[];

		// Based on the entity_type construct the required SQL query. 
		
		var getAlertQuery="";

		if ( thisPeriod.entity_type === 'subnet' ) {
			
			// Check to see if the subnet value passed is in the subnet defined for this period 
			// if so add the alert id to the alert list for this period. 

			if (  isInSubnet(subnetAlertFieldValue,thisPeriod.entity) ) {
				thisPeriod.alerts.push(alert_id);
				logger.info("maintMode-inline: Subnet match " + thisPeriod.entity + " contains  " + subnetAlertFieldValue );
			}

		}
		else { 
			
			// We are direct entity or a regex entity. Check these as direct. 

			if ( thisPeriod.entity_type === "entity" && alertFieldValue.toString() === thisPeriod.entity.toString() ) {
				thisPeriod.alerts.push(alert_id);
				logger.info("maintMode-inline: Entity match " + thisPeriod.entity + " = " + alertFieldValue );
			}

			if ( /regex_(ip|entity)/i.test(thisPeriod.entity_type)  ) { 

				// The regex will be MySQL - incompatilbe with Javascript 
				// e.g. [[:digit:]] in MySQL = \d in JS. 
				// [[:<:]] = \w etc. 
				// there is some overlap at the most simplistic level (.*) 
				// If we switch to mariadb then it uses PCRE :) 

				// We areo going to query the alerts db for our own alert id, with a regex qualifier. 
			
				var matchQuery="";
				matchQuery += "select * from alerts where alert_id = " + alert_id + " and " ;
				matchQuery += alertField + " regexp '" + thisPeriod.entity + "'";

				logger.warning("REGEX: " + matchQuery);

				var matchResults=moogdb.query(matchQuery);
				if ( matchResults && matchResults.rows() === 1 ) {

					// We got a match, the alertField matches the regex.
					thisPeriod.alerts.push(alert_id);
					logger.info("maintMode-inline: Entity regex match " + thisPeriod.entity + " ~= " + alertFieldValue );

				}
/* 
				var myEntityRe=new RegExp(thisPeriod.entity,"i");

				if (myEntityRe.test(alertFieldValue) ) { 
					thisPeriod.alerts.push(alert_id);
					logger.info("maintMode-inline: Entity regex match " + thisPeriod.entity + " ~= " + alertFieldValue );
				}
*/
			}
		}

		// We will get a list back (comma separated) of all the alerts that match the query
		// store this as a string to be used later for updates. 

		if ( thisPeriod.alerts.length > 0 ) {

			updatePeriods.push(thisPeriod);
			logger.info("maintMode-inline: Alert " + alert_id + " is affected by period " + thisPeriod.record_id);
		}
		
	}
	return updatePeriods;

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

				logger.warning("maintMode-inline: Could not retrieve subnet data for entity " + thisPeriod.entity);
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
					logger.warning("maintMode-inline: Unable to get a list of alert ids for record " + thisPeriod.record_id);
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

		logger.info("maintMode-inline: Updating alerts affected by period id  " + thisPeriod.record_id);

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

