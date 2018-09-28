const { QnAMakerRecognizer } = require('botbuilder-cognitiveservices');

class KnowledgeBase {
    constructor() {
        this.recognizer = new QnAMakerRecognizer({
            knowledgeBaseId: process.env.QnaKnowledgebaseId,
            authKey: process.env.QnaAuthKey, // Backward compatibility with QnAMaker (Preview)
            endpointHostName: process.env.EndpointHostName,
            defaultMessage: "Computer sagt Nein",
            top: 3,
            qnaThreshold: 0.2
        });
    }
    ask(session) {
        this.recognizer.recognize(session, (error, results) => {
            if (error) {
                session.send('Es ist ein technisches Problem aufgetreten. Ich kann dir gerade leider nicht helfen.');
                console.log(error);
            }
            else if (results && results.answers && results.answers[0]) {
                // if qna answer available
    
                var bestAnswer = results.answers[0];
                if (bestAnswer.score > 0.4) {
                    // Simple answer
                    session.send(bestAnswer.answer);
                } else if (bestAnswer.score > 0.2) {
                    let amountOfAnswers = 1;
                    if (results.answers[1] && bestAnswer.score - results.answers[1].score <= 0.1) {
                        amountOfAnswers++;
                        if (results.answers[2] && results.answers[1] - results.answers[2] <= 0.075) {
                            amountOfAnswers++;
                        }
                    }
    
                    var msg = 'Ich bin mir nicht sicher was du meinst.';
                    
                    if (amountOfAnswers == 1) {
                        msg += ' Vielleicht hilft dir ja das:\n\n-' + results.answers[0].answer;
                    } else {
                        msg += ' Vielleicht hilft dir eine der folgenden Lösungsansätze:\n';
                        for (var i = 0; i < amountOfAnswers; i++) {
                            msg += '\n\n' + (i + 1) + '. Lösungsvorschlag\n- ' + results.answers[i].answer;
                        }
                    }
                    session.send(msg);
                    setTimeout(function() {
                        session.beginDialog('/helpful');
                    }, 1000);
                } else {
                    session.send('Dazu habe ich leider nichts gefunden. Bitte formulier deine Frage neu. Ich kann für dich sonst auch ein Ticket zu deinem Problem erstellen.');
                }
            } else {
                session.send("This should never happen. Please contact Marcel!");
            }
        });
    }
};

module.exports = KnowledgeBase;