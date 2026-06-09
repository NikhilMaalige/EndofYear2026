import storage, classifier

storage.init_db()
result = classifier.train_from_db()
print(f"Retrain result: {result}")
