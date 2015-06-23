"use strict";

var myUserId = "@example:localhost";
var myAccessToken = "QGV4YW1wbGU6bG9jYWxob3N0.qPEvLuYfNBjxikiCjP";
var sdk = require("matrix-js-sdk");
var matrixClient = sdk.createClient({
    baseUrl: "http://localhost:8008",
    accessToken: myAccessToken,
    userId: myUserId
});

// Data structures
var roomList = [];
var viewingRoom = null;
var numMessagesToShow = 20;

// Reading from stdin
var CLEAR_CONSOLE = '\x1B[2J';
var readline = require("readline");
var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completer
});
rl.setPrompt("$ ");
rl.on('line', function(line) {
    if (line.trim().length === 0) {
        rl.prompt();
        return;
    }
    if (line.indexOf("/join ") === 0 && !viewingRoom) {
        var roomIndex = line.split(" ")[1];
        viewingRoom = roomList[roomIndex];
        if (viewingRoom.getMember(myUserId).membership === "invite") {
            // join the room first
            matrixClient.joinRoom(viewingRoom.roomId).done(function(room) {
                roomList = matrixClient.getRooms();
                viewingRoom = room;
                printMessages();
                rl.prompt();
            }, function(err) {
                console.log("/join Error: %s", err);
            });
        }
        else {
            printMessages();
        }
    }
    else if (line === "/exit" && viewingRoom) {
        viewingRoom = null;
        printRoomList();
    }
    else if (line === "/members" && viewingRoom) {
        printMemberList();
    }
    else if (line === "/resend" && viewingRoom) {
        // get the oldest not sent event.
        var notSentEvent;
        for (var i = 0; i < viewingRoom.timeline.length; i++) {
            if (viewingRoom.timeline[i].status == sdk.EventStatus.NOT_SENT) {
                notSentEvent = viewingRoom.timeline[i];
                break;
            }
        }
        if (notSentEvent) {
            matrixClient.resendEvent(notSentEvent, viewingRoom).done(function() {
                printMessages();
                rl.prompt();
            }, function(err) {
                console.log("/resend Error: %s", err);
            });
        }
    }
    else if (line.indexOf("/more ") === 0 && viewingRoom) {
        var amount = parseInt(line.split(" ")[1]) || 20;
        matrixClient.scrollback(viewingRoom, amount).done(function(room) {
            printMessages();
            rl.prompt();
        }, function(err) {
            console.log("/more Error: %s", err);
        });
    }
    else if (line === "/help") {
        printHelp();
    }
    else if (viewingRoom) {
        matrixClient.sendTextMessage(viewingRoom.roomId, line).finally(function() {
            printMessages();
            rl.prompt();
        });
        // print local echo immediately
        printMessages();
    }
    rl.prompt();
});
// ==== END User input

// show the room list after syncing.
matrixClient.on("syncComplete", function() {
    roomList = matrixClient.getRooms();
    printRoomList();
    printHelp();
    rl.prompt();
});

matrixClient.on("Room", function() {
    roomList = matrixClient.getRooms();
    if (!viewingRoom) {
        printRoomList();
        rl.prompt();
    }
});

// print incoming messages.
matrixClient.on("Room.timeline", function(event, room, toStartOfTimeline) {
    if (toStartOfTimeline) {
        return; // don't print paginated results
    }
    if (!viewingRoom || viewingRoom.roomId !== room.roomId) {
        return; // not viewing a room or viewing the wrong room.
    }
    printLine(event);
});

function printRoomList() {
    console.log("Room List:");
    for (var i = 0; i < roomList.length; i++) {
        console.log(
            "[%s] %s (%s members)",
            i, roomList[i].name, roomList[i].getJoinedMembers().length
        );
    }
}

function printHelp() {
    console.log("Global commands:");
    console.log("  '/help' : Show this help.");
    console.log("Room list index commands:");
    console.log("  '/join <index>' Join a room, e.g. '/join 5'");
    console.log("Room commands:");
    console.log("  '/exit' Return to the room list index.");
    console.log("  '/members' Show the room member list.");
    console.log("  '/more 15' Scrollback 15 events");
    console.log("  '/resend' Resend the oldest event which failed to send.");
}

function completer(line) {
    var completions = [
        "/help", "/join ", "/exit", "/members", "/more ", "/resend"
    ];
    var hits = completions.filter(function(c) { return c.indexOf(line) == 0 });
    // show all completions if none found
    return [hits.length ? hits : completions, line]
}

function printMessages() {
    if (!viewingRoom) {
        printRoomList();
        return;
    }
    console.log(CLEAR_CONSOLE);
    var mostRecentMessages = viewingRoom.timeline;
    for (var i = 0; i < mostRecentMessages.length; i++) {
        printLine(mostRecentMessages[i]);
    }
}

function printMemberList() {
    if (!viewingRoom) {
        printRoomList();
        return;
    }
    var members = viewingRoom.currentState.getMembers();
    // sorted based on name.
    members.sort(function(a, b) {
        if (a.name > b.name) {
            return -1;
        }
        if (a.name < b.name) {
            return 1;
        }
        return 0;
    });
    console.log("Membership list for room \"%s\"", viewingRoom.name);
    console.log(new Array(viewingRoom.name.length + 28).join("-"));
    viewingRoom.currentState.getMembers().forEach(function(member) {
        if (!member.membership) {
            return;
        }
        var membershipWithPadding = (
            member.membership + new Array(10 - member.membership.length).join(" ")
        );
        console.log(
            "%s :: %s (%s)", membershipWithPadding, member.name, 
            (member.userId === myUserId ? "Me" : member.userId)
        );
    });
}

function printLine(event) {
    var name = event.sender ? event.sender.name : event.getSender();
    var time = new Date(
        event.getTs()
    ).toISOString().replace(/T/, ' ').replace(/\..+/, '');
    var separator = "<<<";
    if (event.getSender() === myUserId) {
        name = "Me";
        separator = ">>>";
        if (event.status === sdk.EventStatus.SENDING) {
            separator = "...";
        }
        else if (event.status === sdk.EventStatus.NOT_SENT) {
            separator = " x ";
        }
    }
    var body = "";

    var maxNameWidth = 15;
    if (name.length > maxNameWidth) {
        name = name.substr(0, maxNameWidth-1) + "\u2026";
    }

    if (event.getType() === "m.room.message") {
        body = event.getContent().body;
    }
    else if (event.isState()) {
        var stateName = event.getType();
        if (event.getStateKey().length > 0) {
            stateName += " ("+event.getStateKey()+")";
        }
        body = (
            "[State: "+stateName+" updated to: "+JSON.stringify(event.getContent())+"]"
        );
        separator = "---";
    }
    else {
        // random message event
        body = (
            "[Message: "+event.getType()+" Content: "+JSON.stringify(event.getContent())+"]"
        );
        separator = "---";
    }
    console.log("[%s] %s %s %s", time, name, separator, body);
}

matrixClient.startClient(numMessagesToShow);  // messages for each room.