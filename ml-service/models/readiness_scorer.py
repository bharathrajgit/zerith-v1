class ReadinessScorer:
    def __init__(self):
        # Module-based weights based on actual curriculum structure (14 modules)
        # Weights are distributed based on module importance and topic count
        self.module_weights = {
            'fundamentals': 0.08,      # 7 topics - foundation
            'patterns': 0.04,          # 3 topics - basic practice
            'arrays': 0.10,            # 3 topics - core data structure
            'strings': 0.08,            # 3 topics - core data structure
            'searching': 0.06,         # 3 topics - fundamental algorithm
            'sorting': 0.06,           # 3 topics - fundamental algorithm
            'recursion': 0.08,         # 3 topics - problem solving paradigm
            'linked_lists': 0.08,      # 3 topics - core data structure
            'stack_queue': 0.06,       # 3 topics - core data structures
            'trees': 0.10,             # 3 topics - advanced data structure
            'heaps_hashing': 0.08,     # 3 topics - advanced data structures
            'graphs': 0.10,            # 3 topics - advanced data structure
            'dp': 0.10,                # 3 topics - advanced algorithm
            'advanced_dsa': 0.08,      # 4 topics - expert level
        }
        # Topic-level weights within modules (normalized by topic count)
        self.topic_weights_by_module = {
            'fundamentals': 7,
            'patterns': 3,
            'arrays': 3,
            'strings': 3,
            'searching': 3,
            'sorting': 3,
            'recursion': 3,
            'linked_lists': 3,
            'stack_queue': 3,
            'trees': 3,
            'heaps_hashing': 3,
            'graphs': 3,
            'dp': 3,
            'advanced_dsa': 4,
        }
        # Topic to module mapping
        self.topic_to_module = {
            'flowcharts': 'fundamentals', 'java_architecture': 'fundamentals',
            'first_java_program': 'fundamentals', 'conditionals_loops': 'fundamentals',
            'functions': 'fundamentals', 'oop': 'fundamentals', 'complexity': 'fundamentals',
            'star_patterns': 'patterns', 'number_patterns': 'patterns', 'advanced_patterns': 'patterns',
            'arrays': 'arrays', '2d_arrays': 'arrays', 'array_algorithms': 'arrays',
            'strings': 'strings', 'stringbuilder': 'strings', 'string_pattern': 'strings',
            'linear_search': 'searching', 'binary_search': 'searching', 'binary_search_questions': 'searching',
            'basic_sorting': 'sorting', 'advanced_sorting': 'sorting', 'specialised_sorting': 'sorting',
            'recursion_fundamentals': 'recursion', 'recursive_problem_solving': 'recursion', 'backtracking': 'recursion',
            'singly_linked_list': 'linked_lists', 'doubly_linked_list': 'linked_lists', 'circular_linked_list': 'linked_lists',
            'stack': 'stack_queue', 'queue': 'stack_queue', 'deque_priority': 'stack_queue',
            'binary_tree': 'trees', 'bst': 'trees', 'tree_traversals': 'trees',
            'heap': 'heaps_hashing', 'hashing': 'heaps_hashing', 'advanced_hashing': 'heaps_hashing',
            'graph_representation': 'graphs', 'bfs_dfs': 'graphs', 'shortest_path': 'graphs',
            'dp_fundamentals': 'dp', 'knapsack': 'dp', 'dp_strings_grid': 'dp',
            'trie': 'advanced_dsa', 'greedy': 'advanced_dsa', 'segment_tree': 'advanced_dsa', 'mos_algorithm': 'advanced_dsa',
        }

    def calculate(self, all_topic_mastery):
        """
        all_topic_mastery: dict mapping topic_name (lowercase) to mastery_score (0-100).
        Returns readiness score, level, module contributions, missing modules, estimated days, top priority.
        """
        # Group topics by module and calculate module-level mastery
        module_mastery = {}
        module_topic_counts = {}
        
        for topic_name, score in all_topic_mastery.items():
            # Normalize topic name to match mapping
            normalized_topic = topic_name.lower().replace(' ', '_').replace('-', '_')
            module = self.topic_to_module.get(normalized_topic)
            
            if module:
                if module not in module_mastery:
                    module_mastery[module] = []
                module_mastery[module].append(score)
        
        # Calculate average mastery per module
        module_scores = {}
        for module, scores in module_mastery.items():
            module_scores[module] = sum(scores) / len(scores) if scores else 0
            module_topic_counts[module] = len(scores)
        
        # Calculate weighted readiness score
        contributions = {}
        weighted_sum = 0.0
        total_weight = 0.0
        missing_modules = []
        completed_modules = 0
        
        for module, weight in self.module_weights.items():
            total_weight += weight
            score = module_scores.get(module, 0)
            topic_count = module_topic_counts.get(module, 0)
            total_topics = self.topic_weights_by_module[module]
            
            # Module is considered completed if at least 50% of topics are mastered with score >= 70
            module_completed = topic_count > 0 and score >= 70 and (topic_count / total_topics) >= 0.5
            
            if module_completed:
                completed_modules += 1
            else:
                missing_modules.append(module)
            
            contrib = score * weight
            contributions[module] = {
                'score': round(score, 2),
                'weight': weight,
                'contribution': round(contrib, 2),
                'topics_completed': f"{topic_count}/{total_topics}"
            }
            weighted_sum += contrib
        
        readiness_score = round(weighted_sum / total_weight) if total_weight > 0 else 0
        
        # Readiness level with minimum module completion safeguard
        # Require at least 10 out of 14 modules completed to be Placement Ready
        min_modules_for_placement_ready = 10
        if readiness_score >= 80 and completed_modules >= min_modules_for_placement_ready:
            level = 'Placement Ready'
        elif readiness_score >= 60:
            level = 'Interview Practicing'
        elif readiness_score >= 40:
            level = 'Foundation Building'
        else:
            level = 'Beginner'
        
        # Estimated days to ready (simple linear mapping)
        days_to_ready = max(0, int((80 - readiness_score) * 0.3)) if readiness_score < 80 else 0
        
        # Top priority: highest weight among missing modules
        top_priority = None
        max_weight = -1
        for module in missing_modules:
            if self.module_weights[module] > max_weight:
                max_weight = self.module_weights[module]
                top_priority = module
        if not top_priority:
            # pick the module with lowest contribution
            sorted_modules = sorted(contributions.items(), key=lambda x: x[1]['contribution'])
            top_priority = sorted_modules[0][0] if sorted_modules else None
        
        return {
            'readiness_score': readiness_score,
            'readiness_level': level,
            'module_contributions': contributions,
            'missing_modules': missing_modules,
            'completed_modules': completed_modules,
            'total_modules': len(self.module_weights),
            'estimated_days_to_ready': days_to_ready,
            'top_priority': top_priority
        }