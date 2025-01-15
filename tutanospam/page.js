window.tutanospam = (function() {
    const INBOX = "1";
    const SPAM = "5";

    const mailTypeRef = {
        app: "tutanota",
        type: "Mail"
    };

    const mailSetEntryTypeRef = {
        app: "tutanota",
        type: "MailSetEntry"
    };

    const localStorageKeys = {
        classifier: "tutanospam.classifier",
        lastId: "tutanospam.lastId",
    };

    function getSystemFolderByType(type) {
        return new Promise(function (resolve) {
            tutao.currentView.mailViewModel.mailModel.getFolders().then(function (folders) {
                const folder = folders.values().next().value.folders;
                resolve(folder.getSystemFolderByType(type));
            });
        });
    }

    function loadMails(folder, lastId) {
        const entityClient = tutao.currentView.mailViewModel.entityClient;
        let amount = 50;
        let reverse = false;
        if (!lastId) {
            // Learn many most recent mails
            reverse = true;
            amount = 1000;
            lastId = "zzzzzzzzzzzzzzzzzzzzzzzz";
        }

        if (!folder.isMailSet) {
            console.warn("TutaNoSpam: this is not a mailset folder.");
        }

        return new Promise(function (resolve) {
            entityClient.loadRange(mailSetEntryTypeRef, folder.entries, lastId, amount, reverse).then(function (mailSets) {
                const newLastId = mailSets.map(m => m._id[1]).sort()[0];
                const listIds = [...new Set(mailSets.map(m => m.mail[0]))];
                const promises = listIds.map(function (listId) {
                    const mailIds = mailSets.filter(m => m.mail[0] == listId).map(m => m.mail[1]);
                    return entityClient.loadMultiple(mailTypeRef, listId, mailIds);
                });
                Promise.all(promises).then(mailLists => resolve([mailLists.flat(), newLastId]));
            });
        });
    }

    function learnFolder(folder, classifier, category) {
        return new Promise(function (doneLearning) {
            console.log(`TutaNoSpam: Learning ${category}...`);
            const localStorageKey = localStorageKeys.lastId + "." + category;
            let lastId = localStorage.getItem(localStorageKey);

            const learnTasks = [];

            loadMails(folder, lastId).then(function ([mails, newLastId]) {
                console.log(`TutaNoSpam: Received ${mails.length} to learn as ${category}`);
                for (const mail of mails) {
                    if (!(category === "ham" && mail.unread)) {
                        learnTasks.push(classifier.learn(mail, category));
                    }
                }
                if (newLastId) {
                    localStorage.setItem(localStorageKey, newLastId);
                }
                Promise.all(learnTasks).then(doneLearning);
            });
        });
    }

    function learn() {
        return new Promise(function (doneLearning) {
            const classifier = getClassifier();
            Promise.all([getSystemFolderByType(INBOX), getSystemFolderByType(SPAM)]).then(function (mailboxes) {
                const [inbox, spamFolder] = mailboxes;
                Promise.all([
                    learnFolder(inbox, classifier, "ham"),
                    learnFolder(spamFolder, classifier, "spam")
                ]).then(function () {
                    classifier.save();
                    console.log('TutaNoSpam: Done learning!');
                    doneLearning();
                });
            });
        });
    }

    function selectSpam() {
        const classifier = getClassifier();
        const listModel = tutao.currentView.mailViewModel.listModel;
        const mails = listModel.state.unfilteredItems;
        const spam = new Set();
        for (const [i, mail] of mails.entries()) {
            classifier.categorize(mail).then(function (category) {
                if (category === "spam") {
                    spam.add(mail);
                }
            });
            if (i > 100) {
                break;
            }
        }

        listModel.enterMultiselect();
        for (const item of spam) {
            listModel.onSingleInclusiveSelection(item);
        }
    }

    function moveToSpam() {
        getSystemFolderByType(SPAM).then(function(spamFolder) {
            const listModel = tutao.currentView.mailViewModel.listModel;
            const mails = listModel.getSelectedAsArray();
            tutao.currentView.mailViewModel.mailModel.moveMails(mails, spamFolder);
        });
    }

    function getClassifier() {
        const fromStorage = window.localStorage.getItem(localStorageKeys.classifier);
        if (fromStorage) {
            return fromJson(fromStorage);
        } else {
            return new NaiveBayes();
        }
    }

    function addButton() {
        const filterButton = document.querySelector('button[title="Filter"]');
        if (!filterButton) {
            return false;
        }
        const filterBar = filterButton.parentElement;
        const selectButton = document.createElement("button");
        selectButton.innerText = "Select spam";
        selectButton.setAttribute('class', 'pl');
        selectButton.addEventListener("click", selectSpam);
        filterBar.appendChild(selectButton);

        const moveButton = document.createElement("button");
        moveButton.innerText = "Move to spam";
        moveButton.addEventListener("click", moveToSpam);
        moveButton.setAttribute('class', 'pl');
        filterBar.appendChild(moveButton);
        return true;
    }

    // keys we use to serialize a classifier's state
    const STATE_KEYS = [
        'categories', 'docCount', 'totalDocuments', 'vocabulary', 'vocabularySize',
        'wordCount', 'wordFrequencyCount'
    ];

    /**
     * Initializes a NaiveBayes instance from a JSON state representation.
     * Use this with classifier.toJson().
     *
     * @param  {String} jsonStr   state representation obtained by classifier.toJson()
     * @return {NaiveBayes}       Classifier
     */
    function fromJson(jsonStr) {
        var parsed;
        try {
            parsed = JSON.parse(jsonStr)
        } catch (e) {
            throw new Error('NaiveBayes.fromJson expects a valid JSON string.')
        }
        // init a new classifier
        var classifier = new NaiveBayes()

        // override the classifier's state
        STATE_KEYS.forEach(function(k) {
            if (typeof parsed[k] === 'undefined' || parsed[k] === null) {
                throw new Error('NaiveBayes.fromJson: JSON string is missing an expected property: `' + k + '`.')
            }
            classifier[k] = parsed[k]
        })

        return classifier
    }

    /**
     * Given an input string, tokenize it into an array of word tokens.
     *
     * @param  {String} text
     * @return {Array}
     */
    function tokenizeText(text) {
        //remove punctuation from text - remove anything that isn't a word char or a space
        var rgxPunctuation = /[^(a-zA-ZA-Яa-я0-9_)+\s]/g

        var sanitized = text.toLowerCase().replace(rgxPunctuation, ' ')

        return sanitized.split(/\s+/)
    }

    /**
     * Naive-Bayes Classifier
     *
     * This is a naive-bayes classifier that uses Laplace Smoothing.
     */
    function NaiveBayes() {
        //initialize our vocabulary and its size
        this.vocabulary = {}
        this.vocabularySize = 0

        //number of documents we have learned from
        this.totalDocuments = 0

        //document frequency table for each of our categories
        //=> for each category, how often were documents mapped to it
        this.docCount = {}

        //for each category, how many words total were mapped to it
        this.wordCount = {}

        //word frequency table for each category
        //=> for each category, how frequent was a given word mapped to it
        this.wordFrequencyCount = {}

        //hashmap of our category names
        this.categories = {}
    }

    NaiveBayes.prototype.tokenizer = function (mail) {
        return []
            .concat(tokenizeText(mail.subject || "__emptySubject"))
            .concat(tokenizeText(mail.sender.name))
            .concat([mail.firstRecipient.address]);
    };

    /**
     * Initialize each of our data structure entries for this new category
     *
     * @param  {String} categoryName
     */
    NaiveBayes.prototype.initializeCategory = function(categoryName) {
        if (!this.categories[categoryName]) {
            this.docCount[categoryName] = 0
            this.wordCount[categoryName] = 0
            this.wordFrequencyCount[categoryName] = {}
            this.categories[categoryName] = true
        }
        return this
    }

    /**
     * train our naive-bayes classifier by telling it what `category`
     * the `mail` corresponds to.
     *
     * @param  {Mail} mail
     * @param  {Promise<String>} class
     */
    NaiveBayes.prototype.learn = async function(mail, category) {
        var self = this

        //initialize category data structures if we've never seen this category
        self.initializeCategory(category)

        //update our count of how many documents mapped to this category
        self.docCount[category]++

        //update the total number of documents we have learned from
        self.totalDocuments++

        //normalize the text into a word array
        var tokens = self.tokenizer(mail)

        //get a frequency count for each token in the text
        var frequencyTable = self.frequencyTable(tokens)

        /*
            Update our vocabulary and our word frequency count for this category
         */

        Object
            .keys(frequencyTable)
            .forEach(function(token) {
                //add this word to our vocabulary if not already existing
                if (!self.vocabulary[token]) {
                    self.vocabulary[token] = true
                    self.vocabularySize++
                }

                var frequencyInText = frequencyTable[token]

                //update the frequency information for this word in this category
                if (!self.wordFrequencyCount[category][token])
                    self.wordFrequencyCount[category][token] = frequencyInText
                else
                    self.wordFrequencyCount[category][token] += frequencyInText

                //update the count of all words we have seen mapped to this category
                self.wordCount[category] += frequencyInText
            })

        return self
    }

    /**
     * Determine what category `mail` belongs to.
     *
     * @param  {Mail} mail
     * @return {Promise<string>} category
     */
    NaiveBayes.prototype.categorize = async function(mail) {
        var self = this,
            maxProbability = -Infinity,
            chosenCategory = null

        var tokens = self.tokenizer(mail)
        var frequencyTable = self.frequencyTable(tokens)

        //iterate thru our categories to find the one with max probability for this text
        Object
            .keys(self.categories)
            .forEach(function(category) {

                //start by calculating the overall probability of this category
                //=>  out of all documents we've ever looked at, how many were
                //    mapped to this category
                var categoryProbability = self.docCount[category] / self.totalDocuments

                //take the log to avoid underflow
                var logProbability = Math.log(categoryProbability)

                //now determine P( w | c ) for each word `w` in the text
                Object
                    .keys(frequencyTable)
                    .forEach(function(token) {
                        var frequencyInText = frequencyTable[token]
                        var tokenProbability = self.tokenProbability(token, category)

                        // console.log('token: %s category: `%s` tokenProbability: %d', token, category, tokenProbability)

                        //determine the log of the P( w | c ) for this word
                        logProbability += frequencyInText * Math.log(tokenProbability)
                    })

                if (logProbability > maxProbability) {
                    maxProbability = logProbability
                    chosenCategory = category
                }
            })

        return chosenCategory
    }

    /**
     * Calculate probability that a `token` belongs to a `category`
     *
     * @param  {String} token
     * @param  {String} category
     * @return {Number} probability
     */
    NaiveBayes.prototype.tokenProbability = function(token, category) {
        //how many times this word has occurred in documents mapped to this category
        var wordFrequencyCount = this.wordFrequencyCount[category][token] || 0

        //what is the count of all words that have ever been mapped to this category
        var wordCount = this.wordCount[category]

        //use laplace Add-1 Smoothing equation
        return (wordFrequencyCount + 1) / (wordCount + this.vocabularySize)
    }

    /**
     * Build a frequency hashmap where
     * - the keys are the entries in `tokens`
     * - the values are the frequency of each entry in `tokens`
     *
     * @param  {Array} tokens  Normalized word array
     * @return {Object}
     */
    NaiveBayes.prototype.frequencyTable = function(tokens) {
        var frequencyTable = Object.create(null)

        tokens.forEach(function(token) {
            if (!frequencyTable[token])
                frequencyTable[token] = 1
            else
                frequencyTable[token]++
        })

        return frequencyTable
    }

    /**
     * Dump the classifier's state as a JSON string.
     * @return {String} Representation of the classifier.
     */
    NaiveBayes.prototype.toJson = function() {
        var state = {}
        var self = this
        STATE_KEYS.forEach(function(k) {
            state[k] = self[k]
        })

        var jsonStr = JSON.stringify(state)

        return jsonStr
    }

    NaiveBayes.prototype.save = function() {
        localStorage.setItem(localStorageKeys.classifier, this.toJson());
    };

    function tryInitialize() {
        if (addButton()) {
            clearInterval(tryInitializeInterval);
            learn();
        }
    }
    const tryInitializeInterval = setInterval(tryInitialize, 1000);

    return {
        learn: learn,
        selectSpam: selectSpam,
        addButton: addButton,
        moveToSpam: moveToSpam,
    };
})();
