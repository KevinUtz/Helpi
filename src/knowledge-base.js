const { QnAMakerRecognizer } = require('botbuilder-cognitiveservices');
const util = require('util');
const messages = require('../resources/messages.json');

class KnowledgeBase {
    constructor() {
        this.recognizer = new QnAMakerRecognizer({
            knowledgeBaseId: process.env.QnaKnowledgebaseId,
            authKey: process.env.QnaAuthKey, // Backward compatibility with QnAMaker (Preview)
            endpointHostName: process.env.QnaHostName,
            defaultMessage: "Computer sagt Nein",
            top: 3,
            qnaThreshold: 0.2
        });
    }
    ask(session) {
        // Save question for future ticket
        session.userData.question = session.message.text;
        // Send to QnA Maker
        this.recognizer.recognize(session, (error, results) => {
            if (error) {
                session.send(messages.error + error);
                console.log(error);
            }
            else if (results && results.answers && results.answers[0]) {
                // if qna answer available
                const bestAnswer = results.answers[0];
                const percent = Math.round(bestAnswer.score * 100);
                if (bestAnswer.score > 0.4) {
                    // Simple answer
                    session.send(util.format('%s\n\n%s (%s%)', messages.qna.result, bestAnswer.answer, percent));
                    setTimeout(function() {
                        session.beginDialog('Helpful');
                    }, 1000);
                } else if (bestAnswer.score > 0.2) {
                    let amountOfAnswers = 1;
                    if (results.answers[1] && bestAnswer.score - results.answers[1].score <= 0.1) {
                        amountOfAnswers++;
                        if (results.answers[2] && results.answers[1] - results.answers[2] <= 0.075) {
                            amountOfAnswers++;
                        }
                    }
    
                    if (amountOfAnswers == 1) {
                        session.send(util.format('%s\n\n%s (%s%)', messages.qna.result, bestAnswer.answer, percent));
                    } else {
                        let msg = messages.qna.not_sure + '\n';
                        for (var i = 0; i < amountOfAnswers; i++) {
                            const percent = Math.round(results.answers[i].score * 100);
                            msg += util.format('\n\n%s %s. %s\n- %s (%s%)', i + 1, messages.qna.solution, results.answers[i].answer, percent);
                        }
                        session.send(msg);
                    }
                    setTimeout(function() {
                        session.beginDialog('Helpful');
                    }, 1000);
                } else {
                    session.beginDialog('NoAnswer');
                }
            } else {
                session.send("This should never happen. Please contact Marcel!");
            }
        });
    }
};

module.exports = KnowledgeBase;