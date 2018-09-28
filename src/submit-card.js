const util = require('util');
const { Message } = require('botbuilder');
const nodemailer = require('nodemailer');
const path = require('path');
const ENV_FILE = path.join('./.env');
const env = require('dotenv').config({ path: ENV_FILE });
const cardDraft = require('../resources/cards/submit.json');
const messages = require('../resources/messages.json');

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
const mailOptions = {
    from: process.env.EmailSender,
    to: process.env.EmailRecipient,
    subject: messages.ticket.mail.subject
}

class SubmitCard {
    constructor(session) {
        cardDraft.actions[0].data.id = Math.random().toString(36).substr(2, 16); // generate unique id
        cardDraft.fallbackText = util.format(messages.ticket.submit_card.fallbackText, process.env.ToEmail);
        cardDraft.body[0].items[0].text = messages.ticket.submit_card.title;
        cardDraft.body[1].items[0].text = messages.ticket.submit_card.text;
        cardDraft.body[4].value = session.userData.question;

        this.card = cardDraft;
    }
    send(session) {
        const message = new Message(session);
        message.addAttachment({
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: this.card
        });
        session.send(message);
    }
    static handleSubmit(session, data) {
        if (session.userData.blacklist.includes(data.id)) {
            // Already sent
            session.send(messages.ticket.already_sent);
        } else {
            // Create submit ticket
            mailOptions.text = util.format(messages.ticket.mail.body, data.name, data.office, data.message);
            
            session.send(JSON.stringify(mailOptions));
            session.send(JSON.stringify({
                host: process.env.SMTPHost,
                port: process.env.SMTPPort,
                secure: JSON.parse(process.env.SMTPSSL) || false,
                auth: {
                    user: process.env.SMTPUser,
                    pass: process.env.SMTPPass
                }
            }));
            transporter.sendMail(mailOptions, function (error, info) {
                session.send(error);
                session.send(info);
                if (error) {
                    session.send(util.format(messages.ticket.mail_error, process.env.EmailRecipient));
                    console.log(error);
                } else {
                    // Blacklist current card
                    if (session.userData.blacklist) session.userData.blacklist.push(data.id);
                    else session.userData.blacklist = [data.id];
                    // Thank you
                    session.send(messages.ticket.thank_you);
                }
            });
        }
    }
};

module.exports = SubmitCard;