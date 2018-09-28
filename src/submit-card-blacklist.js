const fs = require('fs');
const { convertCSVToArray } = require('convert-csv-to-array');

const filePath = './storage/submit-cards-blacklist.csv';

class SubmitCardBlacklist {
    static contains(id, callback) {
        fs.readFile(filePath, { encoding: 'utf-8', flag: 'as+' }, function (err, data) {
            if (err) {
                throw err;
            }
            if (data == '') {
                callback(false);
                return;
            }
            const storage = convertCSVToArray(data);
            const blacklisted = storage[0].includes(id);

            callback(blacklisted);
        });
    }
    static add(id) {
        fs.writeFileSync(filePath, id + ',', { flag: 'as+' });
    }
};

module.exports = SubmitCardBlacklist;