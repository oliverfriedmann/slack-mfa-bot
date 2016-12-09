Scoped = require("betajs-scoped/dist/scoped.js");
var BetaJS = require('betajs/dist/beta-noscoped.js');
require('betajs-data/dist/betajs-data-noscoped.js');
require('betajs-server/dist/betajs-server-noscoped.js');
Scoped.binding("betajs", "global:BetaJS");
var Bot = require('slackbots');
var Speakeasy = require('speakeasy');
var Crypto = require('crypto');
var Getopt = require("node-getopt");
var FS = require("fs");


opt = Getopt.create([
    ["", "token=TOKEN", "slack bot token"],
    ["", "crypt=CRYPT", "crypt password"],
    ["", "mongo=MONGO", "mongodb url"],
    ["", "botname=BOTNAME", "bot name"],
]).bindHelp().parseSystem().options;

var LocalConfig = {};
if (FS.existsSync(__dirname + "/local-config.json"))
	LocalConfig = JSON.parse(FS.readFileSync(__dirname + "/local-config.json"));

var Config = {
	token: process.env.TOKEN || opt.token || LocalConfig.token,
	crypt_password: process.env.CRYPT || opt.crypt || LocalConfig.crypt_password,
	mongodb: process.env.MONGODB_URI || opt.mongo || LocalConfig.mongodb,
	name: process.env.BOTNAME || opt.botname || 'mfa-bot',
	next_admin_minutes: process.env.NEXT_ADMIN_MINUTES || 30,
	port: process.env.PORT || 3000
};


var mongodb = new BetaJS.Server.Databases.MongoDatabase(Config.mongodb);




var bot = new Bot({
	token: Config.token,
	name: Config.name
});


var routes = {
	"help": "help",
	"request": "request mfa (service:.+) for (reason:.+)",
	"grant": "grant <@(user:.+)> mfa (service:.+) for (minutes:.+) minutes",
	"decline": "decline <@(user:.+)> mfa (service:.+)",
	"addmfa": "add mfa (service:.+) with key (key:.+)",
	"removemfa": "remove mfa (service:.+)",
	"listmfas": "list mfas",
	"addadmin": "add admin <@(user:.+)> with priority (priority:.+)",
	"removeadmin": "remove admin <@(user:.+)>",
	"listadmins": "list admins",
	"unknown": ".*"
};


var routeParser = new BetaJS.Router.RouteParser(routes);


var Helpers = {
		
	userById: function (id) {
		var user = id;
		bot.users.forEach(function (u) {
			if (u.id == id)
				user = u.name;
		});
		return user;
	},
	
	decryptKey: function (encrypted_key) {
		var decipher = Crypto.createDecipher('aes-256-ctr', Config.crypt_password)
		var dec = decipher.update(encrypted_key, 'hex', "utf8");
		dec += decipher.final('utf8');
		return dec;
	},
	
	encryptKey: function (decrypted_key) {
		decrypted_key = decrypted_key.split("=");
		decrypted_key = decrypted_key.pop();
		var cipher = Crypto.createCipher('aes-256-ctr', Config.crypt_password)
		var crypted = cipher.update(decrypted_key, 'utf8', "hex");
		crypted += cipher.final('hex');
		return crypted;
	},
	
	generateToken: function (encrypted_key) {
		return Speakeasy.totp({
			secret: this.decryptKey(encrypted_key),
			encoding: "base32"
		});
	}

};


var Grants = {
		
	__grants: {},
		
	requestAccess: function (user, service, reason) {
		var key = user + "+" + service;
		if (this.__grants[key] && this.__grants[key].time > BetaJS.Time.now())
			return BetaJS.Promise.value(true);
		this.__grants[key] = this.__grants[key] || {
			time: 0,
			promises: []
		};
		var grant = this.__grants[key];
		if (grant.timer)
			clearTimeout(grant.timer);
		var promise = BetaJS.Promise.create();
		grant.promises.push(promise);
		var askAdmin = function (admins) {
			var admin = admins.next();
			if (!admin) {
				grant.promises.forEach(function (promise) {
					promise.asyncError(true);
				});
				grant.promises = [];
				return;
			}
			bot.postMessageToUser(admin.user, "User @" + user + " is asking permission to access " + service + " in order to '" + reason + "' - grant or decline?");
			grant.timer = setTimeout(function () {
				askAdmin(admins);
			}, Config.next_admin_minutes * 60 * 1000);
		};
		mongodb.getTable("admins").find({}, {sort: {"priority": -1}}).success(function (iter) {
			askAdmin(iter);
		});
		return promise;
	},
	
	grantAccess: function (user, service, minutes) {
		var key = user + "+" + service;
		this.__grants[key] = this.__grants[key] || {
			promises: []
		};
		var grant = this.__grants[key];
		grant.time = BetaJS.Time.now() + minutes * 60 * 1000;
		if (grant.timer)
			clearTimeout(grant.timer);
		grant.promises.forEach(function (promise) {
			promise.asyncSuccess(true);
		});
	},
	
	declineAccess: function (user, service) {
		var key = user + "+" + service;
		if (this.__grants[key]) {
			var grant = this.__grants[key];
			if (grant.timer)
				clearTimeout(grant.timer);
			grant.promises.forEach(function (promise) {
				promise.asyncError(true);
			});
			delete this.__grants[key];
		}
	}
	
};

var Controller = {
	
		
	_requireAdmin: function (user) {
		var promise = BetaJS.Promise.create();
		mongodb.getTable("admins").find({}).success(function (iter) {
			var empty = true;
			var found = false;
			while (iter.hasNext()) {
				empty = false;
				if (iter.next().user === user)
					found = true;
			}
			if (empty || found) {
				promise.asyncSuccess(true);
			} else {
				promise.asyncError(false);
				bot.postMessageToUser(user, 'You are not allowed to ask me this.');
			}
		});
		return promise;
	},
	
	help: function (user) {
		var rts = [];
		var i = 1;
		BetaJS.Objs.iter(routes, function (value) {
			rts.push(i + ") " + value);
			i++;
		});
		rts.pop();
		bot.postMessageToUser(user, 'You can ask me the following things:\n' + rts.join("\n"));
	},
	
	grant: function (user, args) {
		this._requireAdmin(user).success(function () {
			var targetUser = Helpers.userById(args.user);
			Grants.grantAccess(targetUser, args.service, parseInt(args.minutes));
			bot.postMessageToUser(user, "You granted @" + targetUser + " access to " + args.service + " for " + args.minutes + " minutes.");
		});
	},
	
	decline: function (user, args) {
		this._requireAdmin(user).success(function () {
			var targetUser = Helpers.userById(args.user);
			Grants.declineAccess(targetUser, args.service);
			bot.postMessageToUser(user, "You declined @" + targetUser + " access to " + args.service);
		});
	},

	request: function (user, args) {
		mongodb.getTable("mfas").findOne({
			service: args.service
		}).success(function (row) {
			Grants.requestAccess(user, args.service, args.reason).success(function () {
				var token = Helpers.generateToken(row.encrypted_key)
				bot.postMessageToUser(user, "Your token for " + args.service + " is: " + token);
			}).error(function () {
				bot.postMessageToUser(user, "Your request was declined.");
			});
		}, this).error(function (e) {
			bot.postMessageToUser(user, e);
		});
	},
	
	addmfa: function (user, args) {
		this._requireAdmin(user).success(function () {
			mongodb.getTable("mfas").insertRow({
				service: args.service,
				encrypted_key: Helpers.encryptKey(args.key)
			}).success(function () {
				bot.postMessageToUser(user, 'Added mfa ' + args.service);
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},

	listmfas: function (user) {
		this._requireAdmin(user).success(function () {
			mongodb.getTable("mfas").find({}).success(function (iter) {
				bot.postMessageToUser(user, iter.asArray().map(function (row) {
					return "mfa " + row.service;
				}).join("\n"));
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},

	removemfa: function (user, args) {
		this._requireAdmin(user).success(function () {
			mongodb.getTable("mfas").removeRow({
				service: args.service
			}).success(function () {
				bot.postMessageToUser(user, 'Removed mfa ' + args.service);
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},

	addadmin: function (user, args) {
		this._requireAdmin(user).success(function () {
			var targetUser = Helpers.userById(args.user);
			mongodb.getTable("admins").insertRow({
				user: targetUser,
				priority: parseInt(args.priority)
			}).success(function () {
				bot.postMessageToUser(user, 'Added ' + targetUser + ' as admin with priority ' + args.priority);
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},
	
	listadmins: function (user) {
		this._requireAdmin(user).success(function () {
			mongodb.getTable("admins").find({}, {sort: {"priority": -1}}).success(function (iter) {
				bot.postMessageToUser(user, iter.asArray().map(function (row) {
					return "@" + row.user + " with priority " + row.priority;
				}).join("\n"));
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},

	removeadmin: function (user, args) {
		this._requireAdmin(user).success(function () {
			var targetUser = Helpers.userById(args.user);
			mongodb.getTable("admins").removeRow({
				user: targetUser
			}).success(function () {
				bot.postMessageToUser(user, 'Removed ' + targetUser + ' as admin.');
			}).error(function (e) {
				bot.postMessageToUser(user, e);
			});
		});
	},

	unknown: function (user) {
		bot.postMessageToUser(user, "Hello there! I'm not sure I understand you correctly. As a matter of fact, I have no clue. Try 'help' to get started.");
	}	
	
		
};


var messageHandler = function (message) {
	if (message.type === 'message') {
		var route = routeParser.parse(message.text);
		if (route && Controller[route.name])
			Controller[route.name].call(Controller, Helpers.userById(message.user), route.args);
	}
};

bot.on("message", messageHandler);

bot.on('close', function(data){
    console.log("Connection closed... Reconnecting.")
    bot = Bot({
    	token: Config.token,
    	name: Config.name
    });
    bot.on("message", messageHandler);
});


var Express = require("express");

var express = Express();
express.use("", Express["static"](__dirname + "/assets"));
express.listen(Config.port, function () {
	console.log("Listening on", Config.port);
});
