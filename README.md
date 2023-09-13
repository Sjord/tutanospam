# Tutanota

[ttezel/bayes: Naive-Bayes Classifier for node.js](https://github.com/ttezel/bayes)

- tutao
  - appState
  - client (= browser)
  - currentView (= MailView)
    - mailViewModel
      - inboxRuleHandler
      - mailModel
        - eventController
          - addEntityListener (triggert meermaals als mail aankomt)
  - lang
  - locator
    - mailModel
  - m (= mithrill)
  - root (= document.body)
  - testError
  
tutao.locator.mailModel.getMailboxDetails().then(function (d) { window.d = d; });
const inbox = d[0].folders.getSystemFolderByType("1");
const spamFolder = d[0].folders.getSystemFolderByType("5");
spamFolder.mails = Id mailListId
entityClient.loadRange
const mailTypeRef = {app: "tutanota", type: "Mail"};
tutao.locator.entityClient.loadRange(mailTypeRef, spamFolder.mails, "zzzzzzzzzzzz", 1, true) => promise with mail array


mail:
- subject
- toRecipients[]
    - address
- sender
    - address
    - name
- body: Id
- headers: Id
- id: IdTuple
    - 0: list ID
    - 1: element ID
