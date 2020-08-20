require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");

const app = express();

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: "Our little secret.",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.connect("mongodb+srv://" + process.env.ATLASUSER + ":" + process.env.ATLASPASS + "@cluster0.jktcn.mongodb.net/userDB?retryWrites=true&w=majority");
mongoose.set("useCreateIndex", true);

const userSchema = new mongoose.Schema ({
    username: String,
    name: String,
    password: String,
    isAdmin: Boolean
});

userSchema.plugin(passportLocalMongoose);

const User = new mongoose.model("User", userSchema);

const votingStatusSchema = new mongoose.Schema ({
    isOpen: Boolean,
    dateChanged: Date,
    dateOpened: Date,
    dateClosed: Date
});

const Votingstatus = new mongoose.model("Votingstatus", votingStatusSchema);

const gameSchema = new mongoose.Schema ({
    _id: {type: mongoose.Schema.Types.ObjectId},
    name: String,
    isEnabled: Boolean
});

const Game = new mongoose.model("Game", gameSchema);

const voteSchema = new mongoose.Schema ({
    voteDate: Date,
    gameId: {type: mongoose.Schema.Types.ObjectId, ref: Game},
    userId: {type: mongoose.Schema.Types.ObjectId, ref: User}
});

const Vote = new mongoose.model("Vote", voteSchema);

const reasonSchema = new mongoose.Schema ({
    _id: {type: mongoose.Schema.Types.ObjectId},
    key: String,
    text: String
});

const Reason = new mongoose.model("Reason", reasonSchema);

const resultSchema = new mongoose.Schema ({
    _id: {type: mongoose.Schema.Types.ObjectId},
    winnerGameId: {type: mongoose.Schema.Types.ObjectId, ref: Game},
    reasonId: {type: mongoose.Schema.Types.ObjectId, ref: Reason},
    dateResult: Date
});

const Result = new mongoose.model("Result", resultSchema);

passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

var currentResponse = "";

app.get("/", function(req, res) {
    res.render("home");
});

app.get("/login", function(req, res) {
    res.render("login");
});

app.post("/login", function(req, res) {
    const user = new User({
        username: req.body.username,
        password: req.body.password
    });

    req.login(user, function(err) {
        if (!err) {
            passport.authenticate("local")(req, res, function() {
                res.redirect("/menu");
            });
        } else {
            console.log(err);
        }
    });
});

app.get("/register", function(req, res) {
    res.render("register");
});

app.post("/register", function(req, res) {
    User.register({username: req.body.username, name: req.body.name, isAdmin: false}, req.body.password, function(err, user) {
        if (!err) {
            passport.authenticate("local")(req, res, function() {
                res.redirect("/menu");
            });
        } else {
            console.log(err);
            res.redirect("/register");
        }
    })
});

app.get("/menu", function(req, res) {
    if (req.isAuthenticated()) {
        User.findOne({username: req.user.username}, function(err, userData) {
            res.render("menu", {User: req.user.username, isAdmin: userData.isAdmin, response: currentResponse});
        });
    } else {
        res.redirect("/login");
    }
});

app.get("/logout", function(req, res) {
    req.logout();
    res.redirect("/");
});

app.post("/openVoting", function(req, res) {
    Votingstatus.findOne({}, function(err, foundStatus) {
        if (!foundStatus.isOpen) {
            Votingstatus.updateOne({}, {isOpen: true, dateChanged: Date(), dateOpened: Date()}, function(err, status) {
                if (err) {
                    console.log(err);
                }

                currentResponse = "Voting is now open!";
                res.redirect("/menu");
            });
        } else {
            res.redirect("/menu");
        }
    });
});

app.post("/closeVoting", function(req, res) {
    Votingstatus.findOne({}, function(err, foundStatus) {
        if (foundStatus.isOpen) {
            Votingstatus.updateOne({}, {isOpen: false, dateChanged: Date(), dateClosed: Date()}, function(err, status) {
                if (err) {
                    console.log(err);
                }

                calculateResults();
                currentResponse = "Voting is now closed!";
                res.redirect("/menu");
            });
        } else {
            res.redirect("/menu");
        }
    });
});

function calculateResults() {
    Votingstatus.findOne({}, function(err, foundStatus) {
        const dateOpened = foundStatus.dateOpened;
        const dateClosed = foundStatus.dateClosed;

        Vote.aggregate().
            match({voteDate: { $gte: dateOpened, $lte: dateClosed }}).
            group({_id: "$gameId", count: { $sum: 1 }}).
            sort({count: -1}).
            exec(function(err, res) {
                var gameIds = [];
                var counts = [];

                for(i = 0; i < res.length; i++) {
                    gameIds.push(res[i]._id);
                    counts.push(res[i].count);
                }

                //Check if won by most votes
                var wonByMostVotes = true;
                const highestCount = counts[0];
                for(i = 1; i < counts.length; i++) {
                    if (counts[i] === highestCount) {
                        wonByMostVotes = false;
                    }
                }

                if (wonByMostVotes) {
                    const gameId = gameIds[0];

                    Reason.findOne({key: "MostVotes"}, function(err, reasonData) {
                        const reasonId = reasonData._id;

                        Result.insertMany({winnerGameId: gameId, reasonId: reasonId, dateResult: Date()}, function(err) {
                            if (err) {
                                console.log(err);
                            }
                        });
                    });
                } else {
                    var tiedIndexes = [0];

                    for(i = 1; i < counts.length; i++) {
                        if (counts[i] === highestCount) {
                            tiedIndexes.push(i);
                        }
                    }

                    const randomVal = Math.floor(Math.random() * tiedIndexes.length);
                    const gameId = gameIds[randomVal];

                    Reason.findOne({key: "Random"}, function(err, reasonData) {
                        const reasonId = reasonData._id;

                        Result.insertMany({winnerGameId: gameId, reasonId: reasonId, dateResult: Date()}, function(err) {
                            if (err) {
                                console.log(err);
                            }
                        });
                    });
                }
            });
    });
}

app.get("/votingSelection", function(req, res) {
    if (req.isAuthenticated()) {
        User.findOne({username: req.user.username}, function(err, userData) {
            if (userData.isAdmin) {
                Game.find({}, null, {sort: {name: 1}}, function(err, foundGames) {
                    res.render("changeVoting", {gamesList: foundGames});
                });
            } else {
                res.redirect("/menu");
            }
        });
    } else {
        res.redirect("/login");
    }
});

app.get("/vote", function(req, res) {
    if (req.isAuthenticated()) {
        User.findOne({username: req.user.username}, function(err, foundUser) {
            Vote.findOne({userId: foundUser._id}, null, {sort: {voteDate: -1}}, function(err, foundVote) {
                Votingstatus.findOne({}, function(err, foundStatus) {
                    var voteDate = Date.parse('01 Jan 1970 00:00:00 GMT');

                    if (foundVote != null) {
                        voteDate = foundVote.voteDate;
                    }

                    if (voteDate < foundStatus.dateOpened) {
                        if (foundStatus.isOpen) {
                            Game.find({isEnabled: true}, null, {sort: {name: 1}}, function(err, foundGames) {
                                res.render("vote", {gamesList: foundGames});
                            });
                        } else {
                            res.redirect("/menu");
                        }
                    } else {
                        res.redirect("/menu");
                    }
                });
            });
        });
    } else {
        res.redirect("/login");
    }
});

app.get("/results", function(req, res) {
    if (req.isAuthenticated()) {
        Votingstatus.findOne({}, function(err, foundStatus) {
            if (!foundStatus.isOpen) {
                Result.findOne({}, null, {sort: {dateResult: -1}}, function(err, foundResult) {
                    Game.findOne({ _id: foundResult.winnerGameId }, function(err, foundGame) {
                        const gameName = foundGame.name;

                        Reason.findOne({ _id: foundResult.reasonId }, function(err, foundReason) {
                            const reasonText = foundReason.text;

                            Votingstatus.findOne({}, function(err, foundStatus) {
                                const dateOpened = foundStatus.dateOpened;
                                const dateClosed = foundStatus.dateClosed;

                                Vote.aggregate().
                                    lookup({ from: "games", localField: "gameId", foreignField: "_id", as: "gameName"}).
                                    match({voteDate: { $gte: dateOpened, $lte: dateClosed }}).
                                    group({_id: "$gameName.name", count: { $sum: 1 }}).
                                    sort({count: -1}).
                                    exec(function(err, resultVotes) {
                                        res.render("results", {winner: gameName, reason: reasonText, votesArray: resultVotes});
                                    });
                            });
                        });
                    });
                });
            } else {
                res.redirect("/menu");
            }
        });
    } else {
        res.redirect("/login");
    }
});

app.post("/changeEnabled", function(req, res) {
    var changedName = "";
    var checked = false;
    if (req.body.checkbox[0].length > 1) {
        changedName = req.body.checkbox[0];
        checked = true;
    } else {
        changedName = req.body.checkbox
        checked = false;
    }

    Game.updateOne({name: changedName}, {isEnabled: checked}, function(err, foundGames) {
        if (err) {
            console.log(err);
        }
    });
    res.redirect("/votingSelection");
});

app.post("/submitVote", function(req, res) {
    if (typeof req.body.checkbox != "undefined") {
        if (req.body.checkbox[0].length > 1) {
            if (req.body.checkbox.length === 2) {
                for(i = 0; i < req.body.checkbox.length; i++) {
                    Game.findOne({name: req.body.checkbox[i]}, function(err, foundGame) {
                        if (!err) {
                            User.findOne({username: req.user.username}, function(err, foundUser) {
                                if(!err) {
                                    Vote.insertMany({gameId: foundGame.id, userId: foundUser, voteDate: Date()}, function(err) {
                                        if (err) {
                                            console.log(err);
                                        }
                                    });
                                } else {
                                    console.log(err);
                                }
                            });
                        } else {
                            console.log(err);
                        }
                    });
                }

                res.redirect("/menu");
            } else {
                res.redirect("/vote");
            }
        } else {
            res.redirect("/vote");
        }
    } else {
        res.redirect("/vote");
    }
});

app.listen(process.env.PORT || 3000, function() {
    console.log("Server started on port 3000.");
});
