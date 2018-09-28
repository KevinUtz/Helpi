const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require('botbuilder-azure');
const path = require('path');
const ENV_FILE = path.join('./.env');
const env = require('dotenv').config({ path: ENV_FILE });
const nodemailer = require('nodemailer');
const util = require('util');
const submitCard = require('../resources/cards/submit.json');
const messages = require('../resources/messages.json');
const SubmitCardBlacklist  = require('./submit-card-blacklist');
const KnowledgeBase = require('./knowledge-base');

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Setup Restify Server
const server = restify.createServer();
server.post('/api/messages', connector.listen());

// Initialize bot, also callback for action submits
const bot = new builder.UniversalBot(connector, function (session, args) {
    if (session.message && session.message.value && session.message.value.type == "ticket-submit") {
        handleTicketSubmit(session);
    }
    qna.ask(session);
});

// Set azure storage if on production
var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);
if (process.env.BotEnv == 'prod') bot.set('storage', tableStorage);

// Setup luis
const LuisModelUrl = process.env.LuisAPIHostName + '/luis/v2.0/apps/' + process.env.LuisAppId + '?subscription-key=' + process.env.LuisAPIKey;
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

// Setup QnA
const qna = new KnowledgeBase();

// Setup smtp server for mailing
const transporter = nodemailer.createTransport({
    host: process.env.SMTPHost,
    port: process.env.SMTPPort,
    secure: JSON.parse(process.env.SMTPSSL) || false,
    auth: {
        user: process.env.SMTPUser,
        pass: process.env.SMTPPass
    }
});

const handleTicketSubmit = session=> {
    const data = session.message.value;
    // Check if card is blacklisted
    SubmitCardBlacklist.contains(data.id, function (blacklisted) {
        if (blacklisted) {
            session.send(messages.ticket.already_sent);
        } else {
            // Create submit ticket
            const mailOptions = {
                from: process.env.EmailSender,
                to: process.env.EmailRecipient,
                subject: messages.ticket.mail.subject,
                text: util.format(messages.ticket.mail.body, data.name, data.office, data.message)
            };
            transporter.sendMail(mailOptions, function (error, info) {
                if (error) {
                    console.log(error);
                } else {
                    session.send(messages.ticket.thank_you);

                    // Blacklist current card
                    SubmitCardBlacklist.add(data.id);
                }
            });
        }
    });
}

const sendSubmitCard = session => {
    submitCard.actions[0].data.id = Math.random().toString(36).substr(2, 16); // generate unique id
    submitCard.fallbackText = util.format(messages.ticket.submit_card.fallbackText, process.env.ToEmail);
    submitCard.body[0].items[0].text = messages.ticket.submit_card.title;
    submitCard.body[1].items[0].text = messages.ticket.submit_card.text;
    submitCard.body[4].value = qna.getLastQuestion();

    const message = new builder.Message(session);
    message.addAttachment({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: submitCard
    });
    session.send(message);
}

const yesOrNo = string => {
    var answer = string.toLowerCase().trim();
    if ((answer.startsWith('j') || answer.startsWith('y')) && answer.length < 5) {
        return 'yes';
    }
    else if (answer.startsWith('n') && answer.length < 7) {
        return 'no';
    }
    else {
        return null;
    }
}

bot.dialog('NoAnswer', [
    // Say that no answers where found, ask to retry
    function (session) {
        builder.Prompts.text(session, messages.retry.nothing_found + '\n' + messages.retry.question);
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.retry.yes);
                break;
            case 'no':
                session.replaceDialog('CreateTicket');
                break;
            default:
                session.endDialog(messages.invalid_input);
                session.beginDialog('Retry');
                break;
        }
    }
])

// Ask if Helpi was helpful
bot.dialog('Helpful', [
    // Ask if helpi was helpful
    function (session) {
        builder.Prompts.text(session, messages.helpful.question);
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.helpful.yes);
                break;
            case 'no':
                session.replaceDialog('Retry');
                break;
            default:      
                session.endDialog(messages.invalid_input);
                session.beginDialog('Helpful');
                break;
        }
    }
]);

bot.dialog('Retry', [
    // Ask to retry the question
    function (session) {
        builder.Prompts.text(session, messages.retry.question);
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.retry.yes);
                break;
            case 'no':
                session.replaceDialog('CreateTicket');
                break;
            default:
                session.endDialog(messages.invalid_input);
                session.beginDialog('Retry');
                break;
        }
    }
]);

bot.dialog('CreateTicket', [
    // Ask if ticket should be created
    function (session) {
        builder.Prompts.text(session, messages.ticket.question);
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                sendSubmitCard(session);
                session.endDialog();
                break;
            case 'no':
                session.endDialog(messages.ticket.no);
                break;
            default:
                session.endDialog(messages.invalid_input);
                session.beginDialog('CreateTicket');
                break;
        }
    }
]);

// Welcome Message
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                bot.send(new builder.Message()
                    .address(message.address)
                    .text(messages.welcome));
            }
        });
    }
});

bot.dialog('HelpDialog',
    (session) => {
        session.send(messages.welcome);
        session.endDialog();
    }
).triggerAction({
    matches: 'Help'
})

bot.dialog('NoneDialog',
    (session) => {
        qna.ask(session);
        session.endDialog();
    }
).triggerAction({
    matches: 'None'
})

bot.dialog('TicketDialog',
    (session) => {
        session.send(messages.ticket.deny);
        session.endDialog();
        //start QnA
    }
).triggerAction({
    matches: 'Ticket'
})

// When everything is ready, start server
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url); 
 });