/************************************************************
 *                                                          *
 *  Contents of file Copyright (c) Moogsoft Inc 2010        *
 *                                                          *
 *----------------------------------------------------------*
 *                                                          *
 *  WARNING:						    *
 *  THIS FILE CONTAINS UNPUBLISHED PROPRIETARY		
 *  SOURCE CODE WHICH IS THE PROPERTY OF MOOGSOFT INC AND
 *  WHOLLY OWNED SUBSIDIARY COMPANIES.			
 *  PLEASE READ THE FOLLOWING AND TAKE CAREFUL NOTE:
 *						
 *  This source code is confidential and any person who	
 *  receives a copy of it, or believes that they are viewing*
 *  it without permission is asked to notify Phil Tee	
 *  on 07734 591962 or email to phil@moogsoft.com.	
 *  All intellectual property rights in this source code	*
 *  are owned by Moogsoft Inc.  No part of this source		*
 *  code may be reproduced, adapted or transmitted in any	*
 *  form or by any means, electronic, mechanical,
 *  photocopying, recording or otherwise.	
 *					
 *  You have been warned....so be good for goodness sake...	*
 *				
 ************************************************************/
//
// Load necessary modules
//
var logger=LamBot.loadModule("Logger");
var constants=LamBot.loadModule("Constants");
var lamUtils=new LamUtility();

function onLoad()
{
	return;
}

//
// Presend processing.
//

function presend(event)
{
	// 
	// Stream name for maint events.

	var maintStreamName="maintMode";
	var epochTime=lamUtils.epochDate();

	// Set timestamps for the event to prevent
	// debug errors. 

	event.set("first_occurred",epochTime);
	event.set("last_occurred",epochTime);
	event.set("agent_time",epochTime);

	// 
    	//
    	// Sending true, makes this an event on
    	// the MooMs bus
    	//

  	return({ passed: true, stream: maintStreamName });

}

//
// Tell the LamBot that we filter using the presend function
//

LamBot.filterFunction("presend");
