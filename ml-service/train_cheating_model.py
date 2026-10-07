# ml-service/train_cheating_model.py
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import pandas as pd
from models.cheating_detector import CheatingDetector
from sklearn.model_selection import train_test_split

def create_synthetic_cheating_data(n=1000):
    np.random.seed(42)
    data = []
    labels = []
    for _ in range(n):
        is_cheater = np.random.choice([0,1], p=[0.7,0.3])
        if is_cheater:
            avg_time = np.random.normal(2, 0.5)         # very fast
            std_time = np.random.normal(0.5, 0.2)       # very consistent
            fast_slow_ratio = np.random.normal(0.1, 0.05)
            tab_switches = np.random.randint(5, 15)
            copy_attempts = np.random.randint(1, 5)
            window_blur = np.random.randint(8, 20)
            hint_rate = np.random.uniform(0.8, 1)
            changed_answers = np.random.randint(0, 2)
            total_questions = np.random.randint(5, 20)
            past_avg_accuracy = np.random.uniform(30, 60)
        else:
            avg_time = np.random.normal(25, 8)
            std_time = np.random.normal(8, 3)
            fast_slow_ratio = np.random.normal(0.8, 0.2)
            tab_switches = np.random.randint(0, 2)
            copy_attempts = 0
            window_blur = np.random.randint(0, 3)
            hint_rate = np.random.uniform(0, 0.3)
            changed_answers = np.random.randint(0, 1)
            total_questions = np.random.randint(5, 20)
            past_avg_accuracy = np.random.uniform(40, 90)

        row = [avg_time, std_time, fast_slow_ratio, tab_switches,
               copy_attempts, window_blur, hint_rate, changed_answers,
               total_questions, past_avg_accuracy]
        data.append(row)
        labels.append(is_cheater)
    df = pd.DataFrame(data, columns=CheatingDetector().features)
    df['label'] = labels
    return df

if __name__ == '__main__':
    df = create_synthetic_cheating_data(2000)
    X = df.drop(columns=['label']).values
    y = df['label'].values
    detector = CheatingDetector()
    result = detector.train(X, y)
    print(f"Cheating model trained. Accuracy: {result['accuracy']:.2f}")