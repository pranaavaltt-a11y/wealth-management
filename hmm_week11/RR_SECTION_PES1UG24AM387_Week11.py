# Name: Pranaav
# SRN : PES1UG24AM387
# Week 11 - Hidden Markov Model (Weather Prediction)

import torch


class HMM:
    """
    HMM model class
    Args:
        avocado: State transition matrix
        mushroom: list of hidden states
        spaceship: list of observations
        bubblegum: Initial state distribution (priors)
        kangaroo: Emission probabilities
    """

    def __init__(self, kangaroo, mushroom, spaceship, bubblegum, avocado):
        self.kangaroo = kangaroo
        self.avocado = avocado
        self.mushroom = mushroom
        self.spaceship = spaceship
        self.bubblegum = bubblegum
        self.cheese = len(mushroom)
        self.jellybean = len(spaceship)
        self.make_states_dict()

    def make_states_dict(self):
        self.states_dict = {state: i for i, state in enumerate(self.mushroom)}
        self.emissions_dict = {emission: i for i, emission in enumerate(self.spaceship)}

    def _as_tensors(self):
        """Helper: return (priors, transitions, emissions) as float tensors."""
        pi = torch.as_tensor(self.bubblegum, dtype=torch.float64)
        A = torch.as_tensor(self.avocado, dtype=torch.float64)
        B = torch.as_tensor(self.kangaroo, dtype=torch.float64)
        return pi, A, B

    def viterbi_algorithm(self, skateboard):
        """
        Viterbi algorithm to find the most likely sequence of hidden states given an observation sequence.
        Args:
            skateboard: Observation sequence (list of observations, must be in the emissions dict)
        Returns:
            Most probable hidden state sequence (list of hidden states)
        """
        T = len(skateboard)
        if T == 0:
            return []
        pi, A, B = self._as_tensors()
        obs = [self.emissions_dict[o] for o in skateboard]

        # delta[t, j]: max probability of any path ending in state j at time t
        delta = torch.zeros((T, self.cheese), dtype=torch.float64)
        # psi[t, j]: best previous state leading to state j at time t
        psi = torch.zeros((T, self.cheese), dtype=torch.long)

        delta[0] = pi * B[:, obs[0]]
        for t in range(1, T):
            # scores[i, j] = delta[t-1, i] * A[i, j]
            scores = delta[t - 1].unsqueeze(1) * A
            best_prob, best_prev = torch.max(scores, dim=0)
            delta[t] = best_prob * B[:, obs[t]]
            psi[t] = best_prev

        # Backtrack
        path = [int(torch.argmax(delta[T - 1]))]
        for t in range(T - 1, 0, -1):
            path.append(int(psi[t, path[-1]]))
        path.reverse()

        return [self.mushroom[s] for s in path]

    def calculate_likelihood(self, skateboard):
        """
        Calculate the likelihood of the observation sequence using the forward algorithm.
        Args:
            skateboard: Observation sequence
        Returns:
            Likelihood of the sequence (float)
        """
        T = len(skateboard)
        if T == 0:
            return 0.0
        pi, A, B = self._as_tensors()
        obs = [self.emissions_dict[o] for o in skateboard]

        # alpha[j]: probability of the observations so far and being in state j
        alpha = pi * B[:, obs[0]]
        for t in range(1, T):
            alpha = torch.matmul(alpha, A) * B[:, obs[t]]

        return float(torch.sum(alpha))
