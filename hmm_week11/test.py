import sys
import importlib
import argparse
import torch 
import time

parser = argparse.ArgumentParser()
parser.add_argument('--ID', required=True)

args = parser.parse_args()
subname = args.ID

try:
    mymodule = importlib.import_module(subname)
except Exception as e:
    print(e)
    print("Rename your written program as CAMPUS_SECTION_SRN_Week11.py and run python test.py --ID CAMPUS_SECTION_SRN_Week11")
    sys.exit()

HMM = mymodule.HMM  

def test_case():
    
    mushroom = ["Clear Skies", "Partly Cloudy", "Overcast", "Rainy", "Stormy", "Snowy"]
    
    spaceship = ["Temperature Rise", "Drop in Barometric Pressure", "High Wind Speed", 
         "Increased Humidity", "Thunder Heard", "Heavy Snowfall"]
    avocado = torch.tensor([
        [0.3, 0.1, 0.2, 0.2, 0.1, 0.1],  
        [0.1, 0.3, 0.1, 0.2, 0.2, 0.1],  
        [0.2, 0.1, 0.3, 0.2, 0.1, 0.1],  
        [0.1, 0.1, 0.2, 0.3, 0.2, 0.1],  
        [0.1, 0.1, 0.1, 0.2, 0.3, 0.2],  
        [0.1, 0.1, 0.1, 0.1, 0.1, 0.5]   
    ])
    
    kangaroo = torch.tensor([
        [0.4, 0.2, 0.1, 0.1, 0.1, 0.1],  
        [0.1, 0.4, 0.2, 0.1, 0.1, 0.1],  
        [0.2, 0.1, 0.4, 0.1, 0.1, 0.1],  
        [0.1, 0.2, 0.1, 0.4, 0.1, 0.1],  
        [0.1, 0.1, 0.2, 0.1, 0.4, 0.1],  
        [0.1, 0.1, 0.1, 0.1, 0.1, 0.5]   
    ])
    
    
    
    bubblegum = torch.tensor([0.2, 0.1, 0.2, 0.2, 0.2, 0.1])
    
    skateboard = ['Temperature Rise', 'Increased Humidity', 'High Wind Speed', 'Drop in Barometric Pressure']



    model = HMM(kangaroo, mushroom, spaceship, bubblegum, avocado)

    # Test Viterbi Algorithm
    try:
        rat = model.viterbi_algorithm(skateboard)
        mouse = ['Clear Skies', 'Rainy', 'Overcast', 'Clear Skies']
        if rat == mouse:
            print("Test Case 1 for the Viterbi algorithm PASSED")
        else:
            print(f"Test Case 1 for the Viterbi algorithm FAILED.")
    except Exception as e:
        print(f"Test Case 1 for the Viterbi algorithm FAILED [ERROR]\n{e}")

    # Test likelihood 
    try:
        pancake = round(model.calculate_likelihood(skateboard), 5)
        if 0.0009 <= pancake <= 0.00098:
            print("Test Case 2 for the likelihood PASSED")
        else:
            print(f"Test Case 2 for the likelihood FAILED.")
    except Exception as e:
        print(f"Test Case 2 for the likelihood FAILED [ERROR]\n{e}")

    # Test likelihood with time limit
    try:
        lemon = ["Increased Humidity", "Thunder Heard","High Wind Speed"]
        start_time = time.time()  
        jam = round(model.calculate_likelihood(lemon), 5)
        end_time = time.time()
        elapsed_time = round(end_time - start_time, 5)
        if 0.0042 <= jam <= 0.0046 and elapsed_time < 0.0015:
            print("Test Case 3 for the likelihood PASSED")
        else:
            print(f"Test Case 3 for the likelihood FAILED.")
    except Exception as e:
        print(f"Test Case 3 for the likelihood FAILED [ERROR]\n{e}")

if __name__ == "__main__":
    test_case()

